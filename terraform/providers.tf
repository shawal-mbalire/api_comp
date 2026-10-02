terraform {
  required_version = ">= 1.5"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  # Auth: `export DIGITALOCEAN_TOKEN=...` or set do_token in terraform.tfvars
  # (see terraform.tfvars.example). When do_token is null the provider falls
  # back to the DIGITALOCEAN_TOKEN / DIGITALOCEAN_ACCESS_TOKEN env vars.
  token = var.do_token
}