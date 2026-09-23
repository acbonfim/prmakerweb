variable "project_id" {
  description = "ID do projeto GCP (o mesmo do backend: cime-prod)."
  type        = string
}

variable "region" {
  description = "Região do Cloud Run e do Artifact Registry."
  type        = string
  default     = "us-central1"
}

variable "ar_repo_name" {
  description = "Repositório Docker no Artifact Registry para a imagem do front."
  type        = string
  default     = "web"
}

variable "service_name" {
  description = "Nome do serviço Cloud Run do frontend."
  type        = string
  default     = "cime-web"
}

variable "github_repo" {
  description = "Repositório GitHub do front autorizado a deployar (owner/repo)."
  type        = string
  default     = "acbonfim/prmakerweb"
}

variable "domain" {
  description = "Domínio raiz."
  type        = string
  default     = "softhouse.app.br"
}

variable "subdomain" {
  description = "Subdomínio do frontend."
  type        = string
  default     = "app"
}

variable "enable_domain_mapping" {
  description = "Liga o domain mapping (só após verificar o domínio no Search Console)."
  type        = bool
  default     = false
}

variable "min_instances" {
  description = "Instâncias mínimas (0 = scale-to-zero, mais barato, com cold start)."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Instâncias máximas (SPA estático é stateless, pode escalar à vontade)."
  type        = number
  default     = 2
}
