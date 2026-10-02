variable "do_token" {
  type        = string
  sensitive   = true
  default     = null
  description = "DigitalOcean API token (falls back to DIGITALOCEAN_TOKEN)."
}

variable "region" {
  type        = string
  default     = "sfo3"
  description = "DigitalOcean region for both droplets."
}

variable "api_size" {
  type        = string
  default     = "s-2vcpu-2gb"
  description = "API droplet size — runs Traefik + Postgres + ONE API stack. Note: compiling rust/java/.NET stacks is slow at 2 GB; raise to s-4vcpu-8gb for quicker builds."
}

variable "k6_size" {
  type        = string
  default     = "s-2vcpu-2gb"
  description = "k6 load-generator droplet size (only generates traffic)."
}

variable "api_image" {
  type        = string
  default     = "docker-24-04"
  description = "API droplet image — ships Docker Engine + the Compose plugin."
}

variable "ssh_key_names" {
  type        = list(string)
  description = "Names of DigitalOcean SSH keys to install on BOTH droplets."

  validation {
    condition     = length(var.ssh_key_names) > 0
    error_message = "Set at least one DigitalOcean SSH key name; the matching local private key must exist at ssh_private_key (provisioners SSH as root)."
  }
}

variable "ssh_private_key" {
  type        = string
  default     = "~/.ssh/id_ed25519"
  description = "Local path to the private key matching an ssh_key_names entry (expansion of ~ is supported)."
}

variable "ssh_source_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "CIDRs allowed to SSH into both droplets (lock this down for real benchmark runs)."
}

variable "repo_url" {
  type        = string
  default     = "https://github.com/shawal-mbalire/api_comp.git"
  description = "Repository cloned onto both droplets. Push your branch first if the repo is private (or use an SSH URL + a droplet-accessible deploy key)."
}

variable "repo_ref" {
  type        = string
  default     = "main"
  description = "Branch/tag/commit checked out on both droplets."
}

variable "stack" {
  type        = string
  default     = "rust"
  description = "Which SINGLE API stack the API droplet runs. Re-running `terraform apply -var stack=<other>` swaps it (exactly one API is live at a time)."

  validation {
    condition     = contains(["rust", "go", "java", "dotnet", "bun", "node", "fastapi", "php"], var.stack)
    error_message = "stack must be one of: rust, go, java, dotnet, bun, node, fastapi, php."
  }
}

variable "seed" {
  type        = bool
  default     = true
  description = "Seed Postgres on the API droplet. The dataset lives in the pgdata volume and survives stack swaps — set false after the first stack to reuse it."
}

variable "k6_version" {
  type        = string
  default     = "v0.56.0"
  description = "k6 release tag installed on the k6 droplet (https://github.com/grafana/k6/releases)."
}