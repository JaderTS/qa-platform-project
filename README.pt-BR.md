# QA Cloud Platform

*[Read this in English](README.md)*

Plataforma de QA que executa uma suíte de testes automatizados de API contra
APIs públicas (por padrão, [JSONPlaceholder](https://jsonplaceholder.typicode.com/)),
com toda a esteira de infraestrutura para rodar essa suíte de forma agendada
na nuvem e observar os resultados (Prometheus, Grafana e, opcionalmente,
Datadog).

## Arquitetura

```
tests/api/*.spec.ts  --(Playwright)-->  JSONPlaceholder (API pública)
        |
        v
scripts/export-metrics.js --(push)--> Prometheus Pushgateway --> Prometheus --> Grafana
                            \--(push, opcional)--> Datadog
```

A suíte de testes roda em 3 lugares possíveis (escolha um ou combine):

1. **GitHub Actions** — a cada push/PR e agendada de 6 em 6h (`.github/workflows/playwright.yml`).
2. **Docker Compose** — local ou em uma VM (via Ansible), com Prometheus + Grafana + Pushgateway juntos (`docker/docker-compose.yml`).
3. **Kubernetes** — como `CronJob` horário, reportando métricas para um Pushgateway dentro do cluster (`kubernetes/`).

A infraestrutura AWS (`terraform/`) provisiona apenas a VPC/EC2 (e, opcionalmente,
um RDS) que hospedam a opção 2; a opção 3 assume que você já tem um cluster
Kubernetes (kind/minikube local ou EKS).

## Estrutura de pastas

```
qa-cloud-platform/
├── tests/api/            # Testes Playwright (API) contra JSONPlaceholder
├── scripts/              # Export de métricas dos resultados de teste
├── docker/               # docker-compose.yml (testes + Prometheus + Grafana)
├── kubernetes/           # Manifests (CronJob de testes + stack de monitoring)
├── terraform/            # IaC AWS (VPC, EC2, RDS opcional)
├── ansible/              # Provisionamento do EC2 (Docker + stack)
├── monitoring/           # Configs versionadas de Prometheus/Grafana/Datadog
├── .github/workflows/    # CI: testes + terraform plan/apply
└── Dockerfile            # Imagem usada para rodar a suíte de testes
```

## Pré-requisitos

- Node.js 20+
- Docker e Docker Compose (para a opção local com monitoring)
- Terraform >= 1.5 e uma conta AWS (apenas se for provisionar a infra)
- Ansible (apenas se for configurar o EC2 provisionado)
- `kubectl` e um cluster (apenas para a opção Kubernetes)

## 1. Rodando os testes localmente

```bash
npm install
npm test              # roda tests/api/*.spec.ts contra jsonplaceholder.typicode.com
npm run test:report   # abre o relatório HTML do Playwright
```

Para apontar para outra API compatível, sobrescreva a base URL:

```bash
API_BASE_URL=https://reqres.in/api npm test
```

## 2. Rodando com Docker Compose (testes + monitoring)

```bash
cd docker
docker compose up --build
```

Isso sobe:
- `qa-tests`: builda a imagem do `Dockerfile` raiz, roda `playwright test` e depois `npm run metrics:export`, publicando métricas no Pushgateway.
- `pushgateway`: http://localhost:9091
- `prometheus`: http://localhost:9090 (já configurado para raspar o Pushgateway)
- `grafana`: http://localhost:3001 (login `admin` / `admin`, dashboard "QA Cloud Platform" pré-provisionado)

Para rodar a suíte de novo sem recriar tudo:

```bash
docker compose run --rm qa-tests
```

Para também enviar as métricas ao Datadog, exporte `DD_API_KEY` antes de subir o
container `qa-tests` (o Agent do Datadog é opcional e fica atrás de um profile):

```bash
DD_API_KEY=xxxx docker compose --profile datadog up --build
```

## 3. Deploy em Kubernetes

Funciona em qualquer cluster (kind, minikube ou EKS):

```bash
kubectl apply -f kubernetes/namespace.yaml
kubectl apply -f kubernetes/pushgateway.yaml
kubectl apply -f kubernetes/prometheus-deployment.yaml
kubectl create configmap grafana-dashboards \
  --from-file=monitoring/grafana/dashboards -n qa-platform
kubectl apply -f kubernetes/grafana.yaml
```

Antes de aplicar o `CronJob`, publique a imagem de testes em um registry:

```bash
docker build -t ghcr.io/<seu-usuario>/qa-platform-tests:latest .
docker push ghcr.io/<seu-usuario>/qa-platform-tests:latest
# edite kubernetes/cronjob.yaml trocando a imagem CHANGE_ME
kubectl apply -f kubernetes/cronjob.yaml
```

Acesse o Grafana com `kubectl port-forward svc/grafana 3000:3000 -n qa-platform`.

## 4. Provisionando a infraestrutura AWS (Terraform)

Provisiona uma VPC + EC2 (`t3.micro`, elegível ao free tier) com um Elastic IP
fixo, security group liberado nas portas 22/80/443, servindo de runner para o
Docker Compose. RDS é **opcional e desligado por padrão**
(`enable_rds = false`) para não gerar custo sem necessidade.

```bash
cd terraform
terraform init
# edite terraform.tfvars:
#   - key_name: um par de chaves EC2 já existente
#   - allowed_ssh_cidr: restrinja o SSH ao seu IP, ex: "203.0.113.10/32"
#   - domain_name: o domínio que você vai apontar pra essa instância (ex: jaderdomain.app)
terraform plan
terraform apply
```

Isso não roda automaticamente — confirme o `plan` antes de aplicar, pois cria
recursos cobrados pela AWS (mesmo que tudo aqui caiba no free tier). Ao
terminar de usar, destrua para não deixar recursos rodando:

```bash
terraform destroy
```

Pegue o IP público fixo gerado:

```bash
terraform output qa_runner_public_ip
```

### Apontando seu domínio pra ele (ex: um domínio da name.com/Namecheap)

No painel de DNS do seu registrador, crie um **registro A** para o domínio
(ou um subdomínio, ex: `qa.jaderdomain.app`) apontando para o IP do output
`qa_runner_public_ip` acima. A propagação de DNS pode levar alguns minutos;
confira com `dig +short jaderdomain.app` antes de seguir para o Ansible, pois
o Caddy precisa que o domínio já resolva para conseguir emitir o certificado
HTTPS.

## 5. Configurando o EC2 com Ansible (HTTPS + Datadog)

```bash
cd ansible
cp inventory/hosts.ini.example inventory/hosts.ini
# edite hosts.ini com o IP do output do Terraform e o caminho da sua chave .pem
# edite group_vars/all.yml:
#   - qa_platform_repo_url: a URL do seu fork (precisa ser acessível pela instância)
#   - qa_platform_domain: o mesmo domínio que você apontou pro Elastic IP

# opcional: enviar métricas pra sua conta real do Datadog (plano Pro do Student Pack)
export DD_API_KEY=xxxxxxxx

ansible-playbook playbook.yml
```

O playbook instala Docker + Compose, clona o repositório, renderiza o
`docker/.env` (domínio + chave do Datadog), sobe o Prometheus/Grafana/
Pushgateway atrás do **Caddy** (HTTPS automático via Let's Encrypt no seu
domínio), roda a suíte uma vez e agenda (`cron`) para rodar a cada hora, com
log em `/var/log/qa-platform-tests.log`.

Quando terminar, acesse `https://<seu-dominio>` — isso é o Grafana, rodando
de verdade na sua própria instância AWS, com o dashboard "QA Cloud Platform"
mostrando as métricas de pass/fail das execuções agendadas em tempo real. Se
`DD_API_KEY` foi configurada, as mesmas métricas também aparecem na sua conta
Datadog (Metrics Explorer, busque por `qa.tests.*`).

## 6. CI/CD (GitHub Actions)

- `.github/workflows/playwright.yml`: roda os testes em push/PR e agendado
  (`0 */6 * * *`), exporta métricas se `PUSHGATEWAY_URL`/`DD_API_KEY` estiverem
  configurados como secrets do repositório, e publica o relatório como artifact.
- `.github/workflows/terraform.yml`: valida e faz `plan` do Terraform em PRs
  que tocam `terraform/**`. O `apply` só roda via `workflow_dispatch` manual
  (nunca automaticamente em um PR), usando os secrets `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY` e `DB_PASSWORD`.

## Métricas expostas

`scripts/export-metrics.js` lê `test-results/results.json` (reporter JSON do
Playwright) e publica:

| Métrica                      | Descrição                              |
|-------------------------------|-----------------------------------------|
| `qa_tests_total`              | total de testes na execução             |
| `qa_tests_passed`             | testes que passaram                     |
| `qa_tests_failed`             | testes que falharam                     |
| `qa_tests_flaky`              | testes instáveis (passaram no retry)    |
| `qa_tests_skipped`            | testes ignorados                        |
| `qa_tests_duration_seconds`   | duração total da execução               |
| `qa_tests_success_ratio`      | (passed + flaky) / total                |

O dashboard `monitoring/grafana/dashboards/qa-tests.json` já visualiza todas
essas séries.

## Trocando para reqres.in

O suite atual cobre `posts`, `users`, `todos` e `comments` do JSONPlaceholder.
Para testar o [reqres.in](https://reqres.in/) (hoje exige `x-api-key` na
maioria dos endpoints), ajuste `use.baseURL` e `extraHTTPHeaders` em
`playwright.config.ts` e adapte os specs em `tests/api/` aos endpoints de
`users`/`register`/`login` dele.
