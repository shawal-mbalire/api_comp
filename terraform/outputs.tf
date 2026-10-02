output "api_ip" {
  value       = digitalocean_droplet.api.ipv4_address
  description = "API droplet public IP (Traefik edge; ONE stack live)."
}

output "k6_ip" {
  value       = digitalocean_droplet.k6.ipv4_address
  description = "k6 load-generator droplet public IP."
}

output "api_base_url" {
  value       = "http://${digitalocean_droplet.api.ipv4_address}/${var.stack}"
  description = "URL of the currently live stack (Traefik strips the /<stack> prefix before the backend)."
}

output "repo_ref" {
  value       = var.repo_ref
  description = "Ref checked out on both droplets (infra/do_bench.py keeps the k6 droplet in sync with this)."
}

output "ssh_cmd" {
  value       = "ssh -i ${pathexpand(var.ssh_private_key)} root@${digitalocean_droplet.api.ipv4_address}"
  description = "SSH into the API droplet (root)."
}

output "ssh_cmd_k6" {
  value       = "ssh -i ${pathexpand(var.ssh_private_key)} root@${digitalocean_droplet.k6.ipv4_address}"
  description = "SSH into the k6 droplet (root)."
}

output "smoke_cmd" {
  value       = "python3 infra/smoke-test.py --base-url http://${digitalocean_droplet.api.ipv4_address}/${var.stack}"
  description = "Contract smoke test (14 checks) run locally against the live stack via the public IP."
}

output "bench_cmd" {
  value       = "ssh -i ${pathexpand(var.ssh_private_key)} root@${digitalocean_droplet.k6.ipv4_address} 'cd /opt/apicomp && python3 infra/benchmark.py --stack ${var.stack} --base-url http://${digitalocean_droplet.api.ipv4_address}'"
  description = "Full binary-search benchmark from the k6 droplet (off-box traffic)."
}