# Infra do frontend (Cloud Run + nginx). Roda no MESMO projeto do backend (cime-prod),
# mas em estado Terraform próprio (este repo). Não gerencia recursos do backend.

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ])
  service = each.value
  # Não desabilita a API no destroy: o backend usa as mesmas APIs no mesmo projeto.
  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# Artifact Registry (Docker) do front
# -----------------------------------------------------------------------------
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.ar_repo_name
  description   = "Imagem Docker do frontend CIME"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Service Account de runtime (mínimo privilégio; o front não acessa segredos)
# -----------------------------------------------------------------------------
resource "google_service_account" "runtime" {
  account_id   = "cime-web-runtime"
  display_name = "Runtime SA do frontend CIME"
}

# -----------------------------------------------------------------------------
# Cloud Run (nginx servindo o SPA)
# -----------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "web" {
  name                = var.service_name
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello" # placeholder; o CI atualiza

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle = true
      }
    }
  }

  depends_on = [google_project_service.apis]

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# Acesso público (SPA aberto ao navegador).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# -----------------------------------------------------------------------------
# Workload Identity Federation: GitHub Actions do repo do front -> GCP
# -----------------------------------------------------------------------------
resource "google_service_account" "deployer" {
  account_id   = "web-github-deployer"
  display_name = "GitHub Actions deployer (frontend)"
}

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_ar_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-web-pool"
  display_name              = "GitHub Actions Pool (web)"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC (web)"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "wif_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
