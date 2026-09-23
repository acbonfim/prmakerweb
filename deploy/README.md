# Deploy — Frontend (Cloud Run + nginx)

Publica o SPA Angular no **Google Cloud Run** (nginx servindo os arquivos estáticos), no mesmo
projeto GCP do backend (`cime-prod`), com Terraform e CI/CD próprios deste repo.

- Serviço: `cime-web`
- Domínio final: `app.softhouse.app.br`
- As URLs das APIs são build-time (`src/environments/environment.prod.ts`, já apontando para
  `api.softhouse.app.br` e `auth.softhouse.app.br`).

## O que o Terraform provisiona
- Artifact Registry (Docker) para a imagem do front
- Cloud Run público (scale-to-zero, porta 8080)
- Service Account de runtime (mínimo privilégio)
- Workload Identity Federation (GitHub Actions via OIDC, sem chave estática) — pool próprio
  (`github-web-pool`) restrito a `acbonfim/prmakerweb`
- (Opcional/gated) domain mapping `app.softhouse.app.br`

## Passo a passo

### 1. Provisionar
```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # ajuste se necessário
terraform init
terraform apply
```

Outputs → variáveis do GitHub:
```bash
terraform output workload_identity_provider   # -> GCP_WIF_PROVIDER
terraform output deployer_service_account     # -> GCP_DEPLOY_SA
terraform output artifact_registry_repo
terraform output service_url
```

### 2. Variáveis no GitHub (repo do front)
Settings → Secrets and variables → Actions → **Variables**:

| Variável | Valor |
|---|---|
| `GCP_PROJECT_ID` | `cime-prod` |
| `GCP_REGION` | `us-central1` |
| `GCP_AR_REPO` | `web` |
| `GCP_WIF_PROVIDER` | output `workload_identity_provider` |
| `GCP_DEPLOY_SA` | output `deployer_service_account` |

### 3. Deploy
Push na `master`/`main` (ou rode manualmente em Actions). O pipeline builda a imagem
(nginx + `ng build --configuration production`), envia e atualiza o Cloud Run.

## Domínio (cutover)
1. Verifique `softhouse.app.br` no Google Search Console (1 TXT no Registro.br) — cobre subdomínios.
2. `enable_domain_mapping = true` no tfvars e `terraform apply`.
3. `terraform output domain_dns_records` → cadastre o registro no Registro.br para `app`.
4. Valide e remova o registro antigo do MonsterASP.

## Notas
- **Cold start (~1s)**: com `min_instances = 0`. Se quiser eliminar, `min_instances = 1` (sai do custo zero).
  Alternativa com CDN e sem cold start: Firebase Hosting (troca o mecanismo de deploy).
- **Segredos no bundle**: `apiKeyWS`/`secretKey` no `environment.prod.ts` vão embutidos no JS do
  cliente (inerente a SPA). Não coloque segredo real que não possa ser público aí.
- **CORS/SignalR**: o backend precisa permitir a origem `https://app.softhouse.app.br`
  (config `RealTime:AllowedOrigins` no serviço `cime-pullrequest`).
