# QA Cloud Platform

*[Leia em português](README.pt-BR.md)*

A QA platform that runs an automated API test suite against public APIs
(by default, [JSONPlaceholder](https://jsonplaceholder.typicode.com/)), with a
full infrastructure stack to run that suite on a schedule in the cloud and
observe the results in **both** Prometheus/Grafana (self-hosted) and
**Datadog** (managed, with an active monitor/alert - not just metrics sitting
there unused).

## Architecture

```
tests/api/*.spec.ts  --(Playwright)-->  JSONPlaceholder (public API)
        |
        v
scripts/export-metrics.js --(push)--> Prometheus Pushgateway --> Prometheus --> Grafana
                            \--(push)--> Datadog --> datadog_monitor (terraform/datadog.tf)
```

Datadog is a first-class sink, not an optional extra: every test run pushes
`qa.tests.*` metrics straight to the Datadog API (no local Agent needed - see
[Exposed metrics](#exposed-metrics)), and a Terraform-managed monitor
(`terraform/datadog.tf`) watches `qa.tests.failed` and goes red the moment a
run has failures.

The test suite can run in 3 places (pick one or combine them):

1. **GitHub Actions** — on every push/PR and on a schedule every 6h (`.github/workflows/playwright.yml`). On every merge to `main`, a second job builds the `qa-tests` image and publishes it to GHCR (`ghcr.io/<owner>/qa-platform-tests`), so nothing downstream ever has to build it.
2. **Docker Compose** — locally or on a VM (via Ansible), together with Prometheus + Grafana + Pushgateway (`docker/docker-compose.yml`), pulling the pre-built GHCR image.
3. **Kubernetes** — as an hourly `CronJob` pulling the same GHCR image, reporting metrics to a Pushgateway inside the cluster (`kubernetes/`).

The AWS infrastructure (`terraform/`) only provisions the VPC/EC2 (and,
optionally, an RDS instance) that host option 2, plus the Datadog monitor
described above; option 3 assumes you already have a Kubernetes cluster
(local kind/minikube or EKS).

Because the image is always built in CI instead of on the runner, the EC2
instance never has to run `npm ci`/`docker build` itself - it only ever
`docker compose pull`s - which is what keeps a free-tier `t3.micro` (1GB RAM)
viable long-term instead of getting overwhelmed on every deploy.

## Folder structure

```
qa-cloud-platform/
├── tests/api/            # Playwright API tests against JSONPlaceholder
├── scripts/              # Test-run metrics export + QA assistant core logic
├── assistant/            # HTTP endpoint for the QA assistant (optional)
├── docker/               # docker-compose.yml (tests + Prometheus + Grafana)
├── kubernetes/           # Manifests (test CronJob + monitoring stack)
├── terraform/            # IaC: AWS (VPC, EC2, optional RDS), Datadog monitor, optional DO assistant app
├── ansible/              # EC2 provisioning (Docker + stack)
├── monitoring/           # Versioned Prometheus/Grafana/Datadog configs
├── .github/workflows/    # CI: tests + build/push image + terraform plan/apply
└── Dockerfile            # Image used to run the test suite
```

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for the local option with monitoring)
- Terraform >= 1.5 and an AWS account (only if provisioning the infra)
- Ansible (only if configuring the provisioned EC2 instance)
- `kubectl` and a cluster (only for the Kubernetes option)
- A [Groq](https://console.groq.com) API key and a DigitalOcean account (only for the optional QA assistant)

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
docker compose pull   # fetch the pre-built qa-tests image from GHCR instead of building it
docker compose up -d prometheus grafana pushgateway
docker compose run --rm qa-tests
```

This brings up:
- `qa-tests`: pulls `ghcr.io/jaderts/qa-platform-tests:latest` (built by CI - see below), runs `playwright test` and then `npm run metrics:export`, publishing metrics to the Pushgateway **and** to Datadog if `DD_API_KEY` is set.
- `pushgateway`: http://localhost:9091
- `prometheus`: http://localhost:9090 (already configured to scrape the Pushgateway)
- `grafana`: http://localhost:3001 (login `admin` / `admin`, "QA Cloud Platform" dashboard pre-provisioned)

Set `DD_API_KEY` (and `DD_SITE` if you're not on the default `datadoghq.com`
site) before running `qa-tests` so metrics also reach Datadog:

```bash
DD_API_KEY=xxxx DD_SITE=us5.datadoghq.com docker compose run --rm qa-tests
```

If you changed test/script code and want to try it before pushing (CI is
what publishes the real image), build locally instead of pulling:

```bash
docker compose build qa-tests
docker compose run --rm qa-tests
```

The Datadog **Agent** container (host-level metrics/APM, heavier - not the
same as the metric push above) stays behind an explicit profile since it
doesn't fit alongside everything else on a `t3.micro`/`t3.small`:

```bash
DD_API_KEY=xxxx docker compose --profile datadog up -d
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

`kubernetes/cronjob.yaml` already points at `ghcr.io/jaderts/qa-platform-tests:latest`
(built and published by CI on every merge to main - see [CI/CD](#6-cicd-github-actions)),
so there's nothing to build by hand. If your GHCR package is private, create
a pull secret first; if you made it public (Package settings → Change
visibility), skip straight to applying:

```bash
# optional: for a private GHCR package
kubectl create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io --docker-username=<you> --docker-password=<a GHCR read:packages PAT> \
  -n qa-platform
# then add `imagePullSecrets: [{name: ghcr-pull-secret}]` under the pod spec in cronjob.yaml

# optional: to also push metrics to Datadog from inside the cluster
kubectl create secret generic datadog-credentials \
  --from-literal=dd-api-key=xxxxxxxx -n qa-platform

kubectl apply -f kubernetes/cronjob.yaml
```

Access Grafana with `kubectl port-forward svc/grafana 3000:3000 -n qa-platform`.

## 4. Provisioning the AWS infrastructure (Terraform)

Provisions a VPC + EC2 instance (`t3.micro`, free-tier eligible now that the
image is pulled, not built - see above) with a static Elastic IP, security
group open on 22/80/443, and acts as the runner for Docker Compose. RDS is
**optional and disabled by default** (`enable_rds = false`) to avoid
unnecessary cost. It also provisions a **Datadog monitor** (`terraform/datadog.tf`)
that alerts when the test suite reports failures.

The Datadog provider needs an API key *and* an Application key (Datadog UI →
Organization Settings → API Keys / Application Keys) - both passed via
environment variables, never committed:

```bash
cd terraform
export DD_API_KEY=xxxxxxxx
export DD_APP_KEY=xxxxxxxx
terraform init
# edit terraform.tfvars:
#   - key_name: an existing EC2 key pair
#   - allowed_ssh_cidr: restrict SSH to your own IP, e.g. "203.0.113.10/32"
#   - domain_name: the domain you'll point at this instance (e.g. jaderdomain.app)
#   - datadog_site: the site your Datadog org lives on (check the URL when logged in)
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
`docker/.env` (domain + Datadog key/site), **pulls** the pre-built `qa-tests`
image from GHCR (never builds it - that's what makes `t3.micro` safe here),
brings up Prometheus/Grafana/Pushgateway behind **Caddy** (automatic Let's
Encrypt HTTPS on your domain), runs the suite once, and schedules it (`cron`)
to run every hour (pulling the latest image each time), logging to
`/var/log/qa-platform-tests.log`.

Once it finishes, open `https://<your-domain>` — that's Grafana, running for
real on your own AWS instance, with the "QA Cloud Platform" dashboard showing
live pass/fail metrics from the scheduled runs. The same metrics land in your
Datadog account (Metrics Explorer, search for `qa.tests.*`), and the monitor
from step 4 will fire there if a run ever has failures.

## 6. CI/CD (GitHub Actions)

- `.github/workflows/playwright.yml`:
  - **`test`** job: runs the tests on push/PR and on a schedule (`0 */6 * * *`),
    exports metrics to Prometheus/Datadog if `PUSHGATEWAY_URL`/`DD_API_KEY`/`DD_SITE`
    are configured as repository secrets, and publishes the report as an artifact.
  - **`build-and-push`** job: runs only after `test` passes, only on `main`
    (never on a PR), and publishes `ghcr.io/<owner>/qa-platform-tests:latest`
    (and a `:<sha>` tag) using the built-in `GITHUB_TOKEN` - no extra secret
    needed. The first time this runs, go to the package's settings on GitHub
    (`https://github.com/users/<you>/packages/container/qa-platform-tests/settings`)
    and set visibility to **Public** so the EC2 runner and Kubernetes can
    `docker pull` it without credentials.
- `.github/workflows/terraform.yml`: validates and runs `plan` for Terraform
  on PRs that touch `terraform/**`. `apply` only runs via manual
  `workflow_dispatch` (never automatically on a PR), using the
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD`, `DD_API_KEY`
  and `DD_APP_KEY` secrets.

## 7. QA assistant (optional - Groq + DigitalOcean)

A small assistant that answers natural-language questions about the test
suite's health (e.g. "how are the tests doing today?"), backed by the same
`qa.tests.*` metrics in Datadog and [Groq](https://console.groq.com) (free
tier, OpenAI-compatible API) for the language model. Shared logic lives in
`scripts/lib/qa-assistant.js`; it's exposed two ways:

```bash
# CLI - local or in CI
export DD_API_KEY=xxxx DD_APP_KEY=xxxx DD_SITE=us5.datadoghq.com GROQ_API_KEY=xxxx
npm run ask -- "how are the tests doing today?"

# HTTP endpoint - same env vars, then:
npm run assistant   # POST /ask {"question": "..."} on :8080, GET /health
```

To deploy the endpoint for real on **DigitalOcean App Platform** (no server
to manage, covered by GitHub Student Pack credits):

1. One-time: in the DigitalOcean control panel, Apps → Create App → connect
   your GitHub account/repo once, so App Platform is authorized to read it
   (Terraform can't do this OAuth handshake for you). You can abandon the
   wizard right after authorizing - don't click through to "Create app",
   or you'll create a real (billed) app outside Terraform's control that
   conflicts with the one below.
2. Generate a DigitalOcean token (API → Tokens → Generate New Token) with
   **Custom Scopes → Apps: Create, Read, Update, Delete**. Update matters -
   a Create/Read-only token applies fine once but fails with `403` on any
   later `terraform apply` that changes the app.
3. Generate a [Groq API key](https://console.groq.com/keys) (free) and grab
   your Datadog API + Application keys (Organization Settings, two separate
   pages).
4. In **the same terminal session** (exported vars don't survive across
   terminal tabs/windows):
   ```bash
   cd terraform
   export DIGITALOCEAN_TOKEN=xxxxxxxx
   export DD_API_KEY=xxxxxxxx DD_APP_KEY=xxxxxxxx   # authenticates the datadog provider
   export TF_VAR_groq_api_key=xxxxxxxx
   export TF_VAR_dd_api_key=xxxxxxxx                # same value as DD_API_KEY, injected into the app
   export TF_VAR_dd_app_key=xxxxxxxx                # same value as DD_APP_KEY, injected into the app
   # edit terraform.tfvars: enable_assistant = true
   terraform init -upgrade
   terraform plan
   terraform apply
   ```
5. `terraform output assistant_url` gives you the live URL. Tail runtime
   logs with `doctl apps logs <app-id> --type run` if `/ask` errors out.

This is optional and off by default in `variable "enable_assistant"`
(`terraform/variables.tf`), but this repo's own `terraform.tfvars` has it
turned on since the assistant is deployed for real - the core platform
(tests, Prometheus/Grafana, Datadog monitor) doesn't depend on it either way.

## Exposed metrics

`scripts/export-metrics.js` reads `test-results/results.json` (Playwright's
JSON reporter output) and publishes the same numbers to two systems with
different naming conventions:

| Meaning                    | Prometheus (underscored)     | Datadog (dotted)         |
|-----------------------------|-------------------------------|---------------------------|
| total tests in the run      | `qa_tests_total`               | `qa.tests.total`          |
| tests that passed           | `qa_tests_passed`              | `qa.tests.passed`         |
| tests that failed           | `qa_tests_failed`              | `qa.tests.failed`         |
| flaky tests (passed on retry)| `qa_tests_flaky`               | `qa.tests.flaky`          |
| skipped tests                | `qa_tests_skipped`             | `qa.tests.skipped`        |
| total run duration            | `qa_tests_duration_seconds`   | `qa.tests.duration_seconds`|
| (passed + flaky) / total     | `qa_tests_success_ratio`      | `qa.tests.success_ratio`  |

The `monitoring/grafana/dashboards/qa-tests.json` dashboard visualizes the
Prometheus series; the `datadog_monitor.qa_test_failures` resource in
`terraform/datadog.tf` watches `qa.tests.failed` on the Datadog side and
alerts (visible in Datadog → Monitors) the moment a run fails.

## Switching to reqres.in

The current suite covers `posts`, `users`, `todos` and `comments` from
JSONPlaceholder. To test [reqres.in](https://reqres.in/) instead (it now
requires an `x-api-key` on most endpoints), adjust `use.baseURL` and
`extraHTTPHeaders` in `playwright.config.ts` and adapt the specs in
`tests/api/` to its `users`/`register`/`login` endpoints.
