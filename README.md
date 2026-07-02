# QA Cloud Platform

*[Leia em português](README.pt-BR.md)*

A QA platform that runs an automated API test suite against public APIs
(by default, [JSONPlaceholder](https://jsonplaceholder.typicode.com/)), with a
full infrastructure stack to run that suite on a schedule in the cloud and
observe the results (Prometheus, Grafana and, optionally, Datadog).

## Architecture

```
tests/api/*.spec.ts  --(Playwright)-->  JSONPlaceholder (public API)
        |
        v
scripts/export-metrics.js --(push)--> Prometheus Pushgateway --> Prometheus --> Grafana
                            \--(push, optional)--> Datadog
```

The test suite can run in 3 places (pick one or combine them):

1. **GitHub Actions** — on every push/PR and on a schedule every 6h (`.github/workflows/playwright.yml`).
2. **Docker Compose** — locally or on a VM (via Ansible), together with Prometheus + Grafana + Pushgateway (`docker/docker-compose.yml`).
3. **Kubernetes** — as an hourly `CronJob`, reporting metrics to a Pushgateway inside the cluster (`kubernetes/`).

The AWS infrastructure (`terraform/`) only provisions the VPC/EC2 (and,
optionally, an RDS instance) that host option 2; option 3 assumes you already
have a Kubernetes cluster (local kind/minikube or EKS).

## Folder structure

```
qa-cloud-platform/
├── tests/api/            # Playwright API tests against JSONPlaceholder
├── scripts/              # Test-run metrics export
├── docker/               # docker-compose.yml (tests + Prometheus + Grafana)
├── kubernetes/           # Manifests (test CronJob + monitoring stack)
├── terraform/            # AWS IaC (VPC, EC2, optional RDS)
├── ansible/              # EC2 provisioning (Docker + stack)
├── monitoring/           # Versioned Prometheus/Grafana/Datadog configs
├── .github/workflows/    # CI: tests + terraform plan/apply
└── Dockerfile            # Image used to run the test suite
```

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for the local option with monitoring)
- Terraform >= 1.5 and an AWS account (only if provisioning the infra)
- Ansible (only if configuring the provisioned EC2 instance)
- `kubectl` and a cluster (only for the Kubernetes option)

## 1. Running the tests locally

```bash
npm install
npm test              # runs tests/api/*.spec.ts against jsonplaceholder.typicode.com
npm run test:report   # opens the Playwright HTML report
```

To point at a different compatible API, override the base URL:

```bash
API_BASE_URL=https://reqres.in/api npm test
```

## 2. Running with Docker Compose (tests + monitoring)

```bash
cd docker
docker compose up --build
```

This brings up:
- `qa-tests`: builds the image from the root `Dockerfile`, runs `playwright test` and then `npm run metrics:export`, publishing metrics to the Pushgateway.
- `pushgateway`: http://localhost:9091
- `prometheus`: http://localhost:9090 (already configured to scrape the Pushgateway)
- `grafana`: http://localhost:3001 (login `admin` / `admin`, "QA Cloud Platform" dashboard pre-provisioned)

To re-run the suite without rebuilding everything:

```bash
docker compose run --rm qa-tests
```

To also send metrics to Datadog, export `DD_API_KEY` before bringing up the
`qa-tests` container (the Datadog Agent is optional and sits behind a profile):

```bash
DD_API_KEY=xxxx docker compose --profile datadog up --build
```

## 3. Deploying to Kubernetes

Works on any cluster (kind, minikube or EKS):

```bash
kubectl apply -f kubernetes/namespace.yaml
kubectl apply -f kubernetes/pushgateway.yaml
kubectl apply -f kubernetes/prometheus-deployment.yaml
kubectl create configmap grafana-dashboards \
  --from-file=monitoring/grafana/dashboards -n qa-platform
kubectl apply -f kubernetes/grafana.yaml
```

Before applying the `CronJob`, publish the test image to a registry:

```bash
docker build -t ghcr.io/<your-username>/qa-platform-tests:latest .
docker push ghcr.io/<your-username>/qa-platform-tests:latest
# edit kubernetes/cronjob.yaml, replacing the CHANGE_ME image
kubectl apply -f kubernetes/cronjob.yaml
```

Access Grafana with `kubectl port-forward svc/grafana 3000:3000 -n qa-platform`.

## 4. Provisioning the AWS infrastructure (Terraform)

Provisions a VPC + EC2 instance (`t3.micro`, free-tier eligible) with a static
Elastic IP, security group open on 22/80/443, and acts as the runner for
Docker Compose. RDS is **optional and disabled by default**
(`enable_rds = false`) to avoid unnecessary cost.

```bash
cd terraform
terraform init
# edit terraform.tfvars:
#   - key_name: an existing EC2 key pair
#   - allowed_ssh_cidr: restrict SSH to your own IP, e.g. "203.0.113.10/32"
#   - domain_name: the domain you'll point at this instance (e.g. jaderdomain.app)
terraform plan
terraform apply
```

This won't run on its own — review the `plan` before applying, since it
creates resources billed by AWS (though everything here fits the free tier).
When you're done using it, destroy it so nothing keeps running:

```bash
terraform destroy
```

Grab the generated static public IP:

```bash
terraform output qa_runner_public_ip
```

### Pointing your domain at it (e.g. a name.com / Namecheap domain)

In your registrar's DNS panel, create an **A record** for the domain (or a
subdomain, e.g. `qa.jaderdomain.app`) pointing at the `qa_runner_public_ip`
output above. DNS propagation can take a few minutes; check with
`dig +short jaderdomain.app` before moving on to Ansible, since Caddy needs
the domain already resolving to request its HTTPS certificate.

## 5. Configuring the EC2 instance with Ansible (HTTPS + Datadog)

```bash
cd ansible
cp inventory/hosts.ini.example inventory/hosts.ini
# edit hosts.ini with the IP from the Terraform output and the path to your .pem key
# edit group_vars/all.yml:
#   - qa_platform_repo_url: your fork's Git URL (must be reachable from the instance)
#   - qa_platform_domain: the same domain you pointed at the Elastic IP

# optional: forward metrics to your real Datadog account (Student Pack Pro plan)
export DD_API_KEY=xxxxxxxx

ansible-playbook playbook.yml
```

The playbook installs Docker + Compose, clones the repository, renders
`docker/.env` (domain + Datadog key), brings up Prometheus/Grafana/Pushgateway
behind **Caddy** (automatic Let's Encrypt HTTPS on your domain), runs the
suite once, and schedules it (`cron`) to run every hour, logging to
`/var/log/qa-platform-tests.log`.

Once it finishes, open `https://<your-domain>` — that's Grafana, running for
real on your own AWS instance, with the "QA Cloud Platform" dashboard showing
live pass/fail metrics from the scheduled runs. If `DD_API_KEY` was set,
the same metrics also show up in your Datadog account (Metrics Explorer,
search for `qa.tests.*`).

## 6. CI/CD (GitHub Actions)

- `.github/workflows/playwright.yml`: runs the tests on push/PR and on a
  schedule (`0 */6 * * *`), exports metrics if `PUSHGATEWAY_URL`/`DD_API_KEY`
  are configured as repository secrets, and publishes the report as an
  artifact.
- `.github/workflows/terraform.yml`: validates and runs `plan` for Terraform
  on PRs that touch `terraform/**`. `apply` only runs via manual
  `workflow_dispatch` (never automatically on a PR), using the
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `DB_PASSWORD` secrets.

## Exposed metrics

`scripts/export-metrics.js` reads `test-results/results.json` (Playwright's
JSON reporter output) and publishes:

| Metric                        | Description                             |
|-------------------------------|------------------------------------------|
| `qa_tests_total`              | total tests in the run                  |
| `qa_tests_passed`             | tests that passed                       |
| `qa_tests_failed`             | tests that failed                       |
| `qa_tests_flaky`              | flaky tests (passed on retry)           |
| `qa_tests_skipped`            | skipped tests                           |
| `qa_tests_duration_seconds`   | total run duration                      |
| `qa_tests_success_ratio`      | (passed + flaky) / total                |

The `monitoring/grafana/dashboards/qa-tests.json` dashboard already
visualizes all of these series.

## Switching to reqres.in

The current suite covers `posts`, `users`, `todos` and `comments` from
JSONPlaceholder. To test [reqres.in](https://reqres.in/) instead (it now
requires an `x-api-key` on most endpoints), adjust `use.baseURL` and
`extraHTTPHeaders` in `playwright.config.ts` and adapt the specs in
`tests/api/` to its `users`/`register`/`login` endpoints.
