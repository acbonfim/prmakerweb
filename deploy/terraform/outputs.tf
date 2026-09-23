output "artifact_registry_repo" {
  description = "Caminho do repositório Docker do front."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "workload_identity_provider" {
  description = "Valor para a variável de repositório GitHub GCP_WIF_PROVIDER (front)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Valor para a variável de repositório GitHub GCP_DEPLOY_SA (front)."
  value       = google_service_account.deployer.email
}

output "service_url" {
  description = "URL pública do frontend no Cloud Run."
  value       = google_cloud_run_v2_service.web.uri
}
