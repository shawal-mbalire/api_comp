# ─── DigitalOcean: exactly TWO droplets at any time ─────────────────────────
#  - apicomp-api : Traefik + Postgres + ONE API stack, swapped per benchmark run
#  - apicomp-k6  : runs k6 (infra/traffic/benchmark.js via infra/benchmark.py)
#                  OFF-BOX against the API droplet's public IP
#
# Workflow (each API setup runs once, at most 2 droplets exist at any time):
#   terraform apply -var stack=rust      # swap the API droplet to rust
#   python3 infra/do_bench.py --stack rust   # smoke + benchmark from the k6 droplet
#   terraform apply -var stack=go        # ...next stack
#
# `just tf bench <stack>` / `just tf bench-do-all` wrap the full loop; see
# infra/do_bench.py and terraform/README.md.

data "digitalocean_ssh_key" "keys" {
  for_each = toset(var.ssh_key_names)
  name     = each.value
}

# ─── API droplet: one stack + Traefik + Postgres ────────────────────────────
resource "digitalocean_droplet" "api" {
  name       = "apicomp-api"
  region     = var.region
  size       = var.api_size
  image      = var.api_image # docker-24-04: Docker Engine + Compose plugin
  ssh_keys   = [for k in data.digitalocean_ssh_key.keys : k.id]
  user_data  = file("${path.module}/cloud-init-api.yml")
  monitoring = true
  tags       = ["apicomp", "api"]
}

# ─── k6 droplet: off-box load generator (k6 binary + benchmark.py) ──────────
resource "digitalocean_droplet" "k6" {
  name     = "apicomp-k6"
  region   = var.region
  size     = var.k6_size
  image    = "ubuntu-24-04-x64"
  ssh_keys = [for k in data.digitalocean_ssh_key.keys : k.id]
  user_data = templatefile("${path.module}/cloud-init-k6.yml", {
    k6_version = var.k6_version
  })
  monitoring = true
  tags       = ["apicomp", "k6"]
}

# ─── firewall: HTTP to the API droplet, SSH to both, nothing else visible ────
resource "digitalocean_firewall" "bench" {
  name        = "apicomp-bench"
  droplet_ids = [digitalocean_droplet.api.id, digitalocean_droplet.k6.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_source_cidrs
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# ─── API droplet deploy/swap — clone the repo, run infra/do_deploy.py ────────
# Re-running `terraform apply -var stack=<other>` changes the trigger and
# re-runs this provisioner, which swaps which SINGLE stack is live.
resource "null_resource" "api_deploy" {
  triggers = {
    droplet_id = digitalocean_droplet.api.id
    stack      = var.stack
    repo_ref   = var.repo_ref
    seed       = var.seed
  }

  connection {
    type        = "ssh"
    host        = digitalocean_droplet.api.ipv4_address
    user        = "root"
    private_key = file(pathexpand(var.ssh_private_key))
    timeout     = "20m"
  }

  provisioner "remote-exec" {
    inline = [
      "set -e",
      # The docker-24-04 image ships Compose v2; belt-and-braces install else.
      "command -v docker >/dev/null && docker compose version >/dev/null || { apt-get update -y >/dev/null && apt-get install -y docker-compose-plugin >/dev/null; }",
      "mkdir -p /opt/apicomp",
      "if [ ! -d /opt/apicomp/.git ]; then git clone ${var.repo_url} /opt/apicomp; else git -C /opt/apicomp fetch --all >/dev/null; fi",
      "git -C /opt/apicomp checkout ${var.repo_ref}",
      "git -C /opt/apicomp reset --hard ${var.repo_ref}",
      "cd /opt/apicomp",
      "python3 infra/do_deploy.py --stack ${var.stack} ${var.seed ? "--seed" : ""}",
    ]
  }
}

# ─── k6 droplet bootstrap — clone the repo, ensure the k6 binary ────────────
# The benchmark itself is run ON DEMAND (just tf bench <stack> /
# infra/do_bench.py), so this provisioner only prepares the host.
resource "null_resource" "k6_deploy" {
  triggers = {
    droplet_id = digitalocean_droplet.k6.id
    repo_ref   = var.repo_ref
  }

  connection {
    type        = "ssh"
    host        = digitalocean_droplet.k6.ipv4_address
    user        = "root"
    private_key = file(pathexpand(var.ssh_private_key))
    timeout     = "10m"
  }

  provisioner "remote-exec" {
    inline = [
      "set -e",
      "command -v k6 >/dev/null || { curl -fsSL -o /tmp/k6.tgz https://github.com/grafana/k6/releases/download/${var.k6_version}/k6-${var.k6_version}-linux-amd64.tar.gz && tar -xzf /tmp/k6.tgz -C /tmp && install -m 0755 /tmp/k6-${var.k6_version}-linux-amd64/k6 /usr/local/bin/k6; }",
      "mkdir -p /opt/apicomp",
      "if [ ! -d /opt/apicomp/.git ]; then git clone ${var.repo_url} /opt/apicomp; else git -C /opt/apicomp fetch --all >/dev/null; fi",
      "git -C /opt/apicomp checkout ${var.repo_ref}",
      "git -C /opt/apicomp reset --hard ${var.repo_ref}",
      "k6 version",
    ]
  }
}