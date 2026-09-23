# Domain mapping do frontend: app.softhouse.app.br -> Cloud Run (cime-web).
# Desligado por padrão; ligue após verificar o domínio no Google Search Console.
locals {
  fqdn = "${var.subdomain}.${var.domain}"
}

resource "google_cloud_run_domain_mapping" "map" {
  count    = var.enable_domain_mapping ? 1 : 0
  location = var.region
  name     = local.fqdn

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.web.name
  }
}

output "domain_dns_records" {
  description = "Registros DNS a cadastrar no Registro.br para app.softhouse.app.br."
  value       = var.enable_domain_mapping ? google_cloud_run_domain_mapping.map[0].status[0].resource_records : []
}
