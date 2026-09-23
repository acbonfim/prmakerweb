terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Opcional: state remoto em GCS (recomendado se mais de uma pessoa aplica).
  # backend "gcs" {
  #   bucket = "SEU-BUCKET-DE-STATE"
  #   prefix = "cime-web/terraform/state"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
