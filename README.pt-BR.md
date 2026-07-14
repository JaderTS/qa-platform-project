# QA Cloud Platform

*[Read this in English](README.md)*

Plataforma de QA que executa uma suíte de testes automatizados de API contra
APIs públicas (por padrão, [JSONPlaceholder](https://jsonplaceholder.typicode.com/)),
com toda a esteira de infraestrutura para rodar essa suíte de forma agendada
na nuvem e observar os resultados **tanto** no Prometheus/Grafana (self-hosted)
quanto no **Datadog** (gerenciado, com monitor/alerta ativo — não é só métrica
parada sem uso).

## Arquitetura

```
tests/api/*.spec.ts  --(Playwright)-->  JSONPlaceholder (API pública)
        |
        v
scripts/export-metrics.js --(push)--> Prometheus Pushgateway --> Prometheus --> Grafana
                            \--(push)--> Datadog --> datadog_monitor (terraform/datadog.tf)
```

O Datadog é um destino de primeira classe, não um extra opcional: toda
execução de teste manda as métricas `qa.tests.*` direto pra API do Datadog
(sem precisar de Agent local — veja [Métricas expostas](#métricas-expostas)),
e um monitor gerenciado via Terraform (`terraform/datadog.tf`) fica de olho
em `qa.tests.failed` e dispara no momento em que uma execução tem falhas.

A suíte de testes roda em 3 lugares possíveis (escolha um ou combine):

1. **GitHub Actions** — a cada push/PR e agendada de 6 em 6h (`.github/workflows/playwright.yml`). A cada merge no `main`, um segundo job builda a imagem `qa-tests` e publica no GHCR (`ghcr.io/<owner>/qa-platform-tests`), então nada depois disso precisa buildar de novo.
2. **Docker Compose** — local ou em uma VM (via Ansible), com Prometheus + Grafana + Pushgateway juntos (`docker/docker-compose.yml`), puxando a imagem pronta do GHCR.
3. **Kubernetes** — como `CronJob` horário, puxando a mesma imagem do GHCR e reportando métricas para um Pushgateway dentro do cluster (`kubernetes/`).

A infraestrutura AWS (`terraform/`) provisiona apenas a VPC/EC2 (e,
opcionalmente, um RDS) que hospedam a opção 2, além do monitor do Datadog
descrito acima; a opção 3 assume que você já tem um cluster Kubernetes
(kind/minikube local ou EKS).

Como a imagem sempre é buildada no CI em vez de no runner, a instância EC2
nunca precisa rodar `npm ci`/`docker build` — ela só faz `docker compose
pull` — e é isso que mantém um `t3.micro` do free tier viável no longo prazo,
em vez de travar a cada deploy.

## Estrutura de pastas

```
qa-cloud-platform/
├── tests/api/            # Testes Playwright (API) contra JSONPlaceholder
├── scripts/              # Export de métricas + lógica central do assistente de IA
├── assistant/            # Endpoint HTTP do assistente de IA
├── docker/               # docker-compose.yml (testes + Prometheus + Grafana + assistente)
├── kubernetes/           # Manifests (CronJob de testes + stack de monitoring)
├── terraform/            # IaC: AWS (VPC, EC2, RDS opcional), monitor Datadog
├── ansible/              # Provisionamento do EC2 (Docker + stack)
├── monitoring/           # Configs versionadas de Prometheus/Grafana/Datadog
├── .github/workflows/    # CI: testes + build/push da imagem + terraform plan/apply
└── Dockerfile            # Imagem usada para rodar a suíte de testes
```

## Pré-requisitos

- Node.js 20+
- Docker e Docker Compose (para a opção local com monitoring)
- Terraform >= 1.5 e uma conta AWS (apenas se for provisionar a infra)
- Ansible (apenas se for configurar o EC2 provisionado)
- `kubectl` e um cluster (apenas para a opção Kubernetes)
- Uma API key do [Groq](https://console.groq.com) (apenas para o assistente de IA)
- Conta Datadog (API Key + Application Key) se for usar o monitor via Terraform

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
docker compose pull   # baixa a imagem pronta do qa-tests do GHCR, em vez de buildar
docker compose up -d prometheus grafana pushgateway assistant
docker compose run --rm qa-tests
```

Isso sobe:
- `qa-tests`: puxa `ghcr.io/jaderts/qa-platform-tests:latest` (buildada pelo CI — veja abaixo), roda `playwright test` e depois `npm run metrics:export`, publicando métricas no Pushgateway **e** no Datadog se `DD_API_KEY` estiver setada.
- `pushgateway`: http://localhost:9091
- `prometheus`: http://localhost:9090 (já configurado para raspar o Pushgateway)
- `grafana`: http://localhost:3001 (login `admin` / `admin`, dashboard "QA Cloud Platform" pré-provisionado)
- `assistant`: o assistente de QA (veja o [passo 7](#7-assistente-de-qa-groq-roda-na-mesma-instância-ec2)) — `curl -X POST localhost:8080/ask -d '{"question":"..."}'` se você expôs a porta, senão só é acessível via Caddy em produção.

Defina `DD_API_KEY` (e `DD_SITE` se sua conta não estiver no site padrão
`datadoghq.com`) antes de rodar o `qa-tests` pra métrica também chegar no
Datadog:

```bash
DD_API_KEY=xxxx DD_SITE=us5.datadoghq.com docker compose run --rm qa-tests
```

Se você mudou código de teste/script e quer testar antes de dar push (o CI
é quem publica a imagem real), builda local em vez de puxar:

```bash
docker compose build qa-tests
docker compose run --rm qa-tests
```

O container do **Agent** do Datadog (métricas de host/APM, mais pesado — não
é a mesma coisa que o push de métricas acima) continua atrás de um profile
explícito, porque não cabe junto do resto num `t3.micro`/`t3.small`:

```bash
DD_API_KEY=xxxx docker compose --profile datadog up -d
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

O `kubernetes/cronjob.yaml` já aponta pra `ghcr.io/jaderts/qa-platform-tests:latest`
(buildada e publicada pelo CI a cada merge no main — veja [CI/CD](#6-cicd-github-actions)),
então não tem nada pra buildar na mão. Se o seu pacote do GHCR for privado,
crie um pull secret antes; se deixou público (Package settings → Change
visibility), já pode aplicar direto:

```bash
# opcional: se o pacote do GHCR for privado
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io --docker-username=<voce> --docker-password=<um PAT com read:packages> \
  -n qa-platform
# depois adicione `imagePullSecrets: [{name: ghcr-pull-secret}]` no pod spec do cronjob.yaml

# opcional: pra também mandar métricas pro Datadog de dentro do cluster
kubectl create secret generic datadog-credentials \
  --from-literal=dd-api-key=xxxxxxxx -n qa-platform

kubectl apply -f kubernetes/cronjob.yaml
```

Acesse o Grafana com `kubectl port-forward svc/grafana 3000:3000 -n qa-platform`.

## 4. Provisionando a infraestrutura AWS (Terraform)

Provisiona uma VPC + EC2 (`t3.micro`, elegível ao free tier agora que a
imagem é puxada, não buildada — veja acima) com um Elastic IP fixo, security
group liberado nas portas 22/80/443, servindo de runner para o Docker
Compose. RDS é **opcional e desligado por padrão** (`enable_rds = false`)
para não gerar custo sem necessidade. Também provisiona um **monitor do
Datadog** (`terraform/datadog.tf`) que alerta quando a suíte de testes
reporta falhas.

O provider do Datadog precisa de uma API Key *e* de uma Application Key
(Datadog UI → Organization Settings → API Keys / Application Keys), ambas
passadas por variável de ambiente, nunca commitadas:

```bash
cd terraform
export DD_API_KEY=xxxxxxxx
export DD_APP_KEY=xxxxxxxx
terraform init
# edite terraform.tfvars:
#   - key_name: um par de chaves EC2 já existente
#   - allowed_ssh_cidr: restrinja o SSH ao seu IP, ex: "203.0.113.10/32"
#   - domain_name: o domínio que você vai apontar pra essa instância (ex: jaderdomain.app)
#   - datadog_site: o site da sua conta Datadog (confira a URL quando estiver logado)
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

## 5. Configurando o EC2 com Ansible (HTTPS + Datadog + assistente)

```bash
cd ansible
cp inventory/hosts.ini.example inventory/hosts.ini
# edite hosts.ini com o IP do output do Terraform e o caminho da sua chave .pem
# edite group_vars/all.yml:
#   - qa_platform_repo_url: a URL do seu fork (precisa ser acessível pela instância)
#   - qa_platform_domain: o mesmo domínio que você apontou pro Elastic IP
#   - dd_site: o site da sua conta Datadog (confira a URL quando estiver logado)

export DD_API_KEY=xxxxxxxx      # manda métricas pra sua conta real do Datadog
export DD_APP_KEY=xxxxxxxx      # necessário pro assistente conseguir consultar as métricas
export GROQ_API_KEY=xxxxxxxx    # alimenta o modelo de linguagem do assistente

ansible-playbook playbook.yml
```

O playbook instala Docker + Compose, clona o repositório, renderiza o
`docker/.env` (domínio, chaves do Datadog e do Groq), **puxa** a imagem
pronta do `qa-tests` do GHCR (nunca builda — é isso que deixa o `t3.micro`
seguro aqui), sobe o Prometheus/Grafana/Pushgateway/**assistant** atrás do
**Caddy** (HTTPS automático via Let's Encrypt no seu domínio), roda a suíte
uma vez e agenda (`cron`) para rodar a cada hora (puxando a imagem mais
recente a cada vez), com log em `/var/log/qa-platform-tests.log`.

Quando terminar, acesse `https://<seu-dominio>` — isso é o Grafana, rodando
de verdade na sua própria instância AWS, com o dashboard "QA Cloud Platform"
mostrando as métricas de pass/fail das execuções agendadas em tempo real, e
`POST https://<seu-dominio>/ask` responde perguntas sobre os mesmos dados
(veja o [passo 7](#7-assistente-de-qa-groq-roda-na-mesma-instância-ec2)). As
métricas também caem na sua conta Datadog (Metrics Explorer, busque por
`qa.tests.*`), e o monitor do passo 4 dispara lá se alguma execução tiver
falhas.

### Troubleshooting: a primeira execução trava / SSH para de responder

O `t3.micro` tem 1GB de RAM e créditos de CPU limitados (burstable).
Instalar o Docker, clonar o repo, puxar cinco imagens e subir cinco
containers tudo de uma vez — só na **primeira** execução — pode
ocasionalmente esgotar os dois recursos, a ponto até do SSH parar de
responder (o handshake TCP funciona, mas o banner nunca chega). Se isso
acontecer:

```bash
# em terraform/, temporariamente:
sed -i '' 's/t3.micro/t3.small/' terraform.tfvars   # ou edite manualmente
terraform apply
# espera ~30s o resize terminar, depois roda de novo:
cd ../ansible && ansible-playbook playbook.yml
```

Depois que os containers subirem e as imagens estiverem em cache, volta
pro tamanho menor — em regime estável (a stack parada + o cron horário)
cabe tranquilo no `t3.micro`:

```bash
# terraform.tfvars: instance_type = "t3.micro"
terraform apply
```

As políticas `restart: unless-stopped` do Docker (já configuradas em todo
serviço de longa duração) religam tudo sozinhas depois do reboot do
resize — não precisa rodar o Ansible de novo.

## 6. CI/CD (GitHub Actions)

- `.github/workflows/playwright.yml`:
  - job **`test`**: roda os testes em push/PR e agendado (`0 */6 * * *`),
    exporta métricas pro Prometheus/Datadog se `PUSHGATEWAY_URL`/`DD_API_KEY`/`DD_SITE`
    estiverem configurados como secrets do repositório, e publica o relatório
    como artifact.
  - job **`build-and-push`**: roda só depois que `test` passa, só no `main`
    (nunca em PR), e publica `ghcr.io/<owner>/qa-platform-tests:latest` (e
    uma tag `:<sha>`) usando o `GITHUB_TOKEN` embutido — sem precisar de
    secret extra. Na primeira vez que isso rodar, vá nas configurações do
    pacote no GitHub (`https://github.com/users/<voce>/packages/container/qa-platform-tests/settings`)
    e mude a visibilidade pra **Public**, pra o runner EC2 e o Kubernetes
    conseguirem dar `docker pull` sem credencial.
  - job **`publish-report`**: publica o relatório HTML do Playwright no
    **GitHub Pages** depois de toda execução no `main` (push, o agendamento
    de 6h, ou dispatch manual) — nunca a partir de um PR. Fica em
    `https://<owner>.github.io/<repo>/`, sem precisar de login, então o
    resultado das execuções agendadas fica visível pra qualquer pessoa, não
    só quem tem acesso ao repositório. Publica mesmo quando os testes falham
    — é exatamente esse o ponto, é a prova de que o agendamento é real.
    Configuração única: Settings → Pages → Build and deployment → Source:
    **GitHub Actions** (já feito nesse repo via
    `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`).
- `.github/workflows/terraform.yml`: valida e faz `plan` do Terraform em PRs
  que tocam `terraform/**`. O `apply` só roda via `workflow_dispatch` manual
  (nunca automaticamente em um PR), usando os secrets `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD`, `DD_API_KEY` e `DD_APP_KEY`.

## 7. Assistente de QA (Groq, roda na mesma instância EC2)

Um pequeno assistente que responde perguntas em linguagem natural sobre a
saúde da suíte de testes (ex: "como estão os testes hoje?"), usando as mesmas
métricas `qa.tests.*` do Datadog e o [Groq](https://console.groq.com) (tier
gratuito, API compatível com OpenAI) como modelo de linguagem. A lógica fica
em `scripts/lib/qa-assistant.js`, exposta de duas formas:

```bash
# CLI - local ou no CI
export DD_API_KEY=xxxx DD_APP_KEY=xxxx DD_SITE=us5.datadoghq.com GROQ_API_KEY=xxxx
npm run ask -- "como estão os testes hoje?"

# Endpoint HTTP - mesmas env vars, depois:
npm run assistant   # POST /ask {"question": "..."} na porta 8080, GET /health
```

Em produção é só mais um serviço no `docker/docker-compose.yml`
(`assistant`) — reaproveita exatamente a mesma imagem
`ghcr.io/.../qa-platform-tests` já puxada pro `qa-tests` (ela já contém
`assistant/` e `scripts/lib/`, então não tem nada extra pra buildar ou
publicar), só rodando `node assistant/server.js` em vez da suíte de testes.
O Caddy roteia `https://<seu-dominio>/ask` direto pra ele (veja
`docker/Caddyfile`) — o Ansible já sobe ele junto com Prometheus/Grafana no
passo 5, sem deploy separado, sem fatura de hospedagem separada.

Inicialmente publicamos isso na DigitalOcean App Platform, usando o crédito
de DO do GitHub Student Pack — movemos pra aqui depois que a DigitalOcean
anunciou que está
[encerrando essa parceria](https://github.com/orgs/community/discussions/200663)
(os créditos expiram em 31/07/2026). Rodar numa infraestrutura que você já
paga é melhor do que depender de um segundo free tier que também pode
mudar de política depois.

## Métricas expostas

`scripts/export-metrics.js` lê `test-results/results.json` (reporter JSON do
Playwright) e publica os mesmos números em dois sistemas, com convenções de
nome diferentes:

| Significado                        | Prometheus (underscore)      | Datadog (ponto)            |
|-------------------------------------|--------------------------------|------------------------------|
| total de testes na execução         | `qa_tests_total`               | `qa.tests.total`             |
| testes que passaram                 | `qa_tests_passed`              | `qa.tests.passed`            |
| testes que falharam                 | `qa_tests_failed`              | `qa.tests.failed`            |
| testes instáveis (passaram no retry)| `qa_tests_flaky`               | `qa.tests.flaky`             |
| testes ignorados                    | `qa_tests_skipped`             | `qa.tests.skipped`           |
| duração total da execução           | `qa_tests_duration_seconds`    | `qa.tests.duration_seconds`  |
| (passed + flaky) / total            | `qa_tests_success_ratio`       | `qa.tests.success_ratio`     |

O dashboard `monitoring/grafana/dashboards/qa-tests.json` visualiza a série
do Prometheus; o recurso `datadog_monitor.qa_test_failures` em
`terraform/datadog.tf` fica de olho em `qa.tests.failed` do lado do Datadog e
alerta (visível em Datadog → Monitors) no momento em que uma execução falha.

## Trocando para reqres.in

O suite atual cobre `posts`, `users`, `todos` e `comments` do JSONPlaceholder.
Para testar o [reqres.in](https://reqres.in/) (hoje exige `x-api-key` na
maioria dos endpoints), ajuste `use.baseURL` e `extraHTTPHeaders` em
`playwright.config.ts` e adapte os specs em `tests/api/` aos endpoints de
`users`/`register`/`login` dele.
