# DigitalOcean — 2-droplet benchmark rig

Deploys **exactly two droplets** and runs the api_comp benchmark **off-box**:

| Droplet | Runs | Swapped per run? |
|---|---|---|
| `apicomp-api` | Traefik + Postgres + **ONE** API stack (`docker compose -f compose/base.yml -f compose/<stack>.yml`) | yes — `terraform apply -var stack=<stack>` |
| `apicomp-k6` | k6 (`infra/traffic/benchmark.js`) + `infra/benchmark.py` against the API droplet's public IP | no — long-lived |

So each API setup runs once on the API droplet while the k6 droplet generates
traffic from a second machine — at any moment **2 droplets exist**.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/downloads) ≥ 1.5, `just`, Python 3 (local), and `docker` (local, optional).
- A [DigitalOcean API token](https://cloud.digitalocean.com/account/api/tokens): `export DIGITALOCEAN_TOKEN=dop_v1_...`
- At least one SSH key in your DO account (`Settings → Security → SSH keys`) and its **private key locally**.

## One-time setup

```bash
just tf init
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
$EDITOR terraform/terraform.tfvars     # token (or env), ssh_key_names, ssh_private_key, repo_url
```

`ssh_key_names` is required (both droplets are provisioned via SSH as `root`),
and `repo_url` must be reachable from the droplets — push your branch first if
the repo is private, or use an SSH URL once you add a droplet deploy key.

## Deploy the first stack

```bash
just tf apply          # uses stack=… from terraform.tfvars (default rust)
```

This creates both droplets, clones the repo to `/opt/apicomp` on each, seeds
Postgres once (`seed = true`), builds the selected stack behind Traefik, and
waits for `http://<api-ip>/<stack>/health`.

Check it: `curl http://$(just tf output -raw api_ip)/rust/health` (or use the
`smoke_cmd` / `api_base_url` outputs).

## Run one benchmark run (each API setup runs once)

```bash
just bench-do rust     # swap API droplet to rust, then smoke + benchmark off-box
```

`just bench-do <stack>` runs `infra/do_bench.py`:

1. `terraform apply -var stack=<stack>` — swaps the API droplet (exactly one AI live)
2. ssh to the k6 droplet — refresh repo at the deployed ref, then the **14-check contract smoke test** against `http://<api-ip>/<stack>`
3. ssh to the k6 droplet — full binary-search benchmark: `python3 infra/benchmark.py --stack <stack> --base-url http://<api-ip>`
4. `scp` the report back to `infra/metrics/<stack>.md`

Run all 8 setups once, in order:

```bash
just bench-do-all
```

Each stack takes ~15–25 min (warm-up + 2-min doubling runs + binary search +
mandatory 5-min confirmation). After the first stack, set `seed = false` in
`terraform.tfvars` — the dataset lives in the `pgdata` volume and survives
stack swaps, so subsequent runs reuse it.

## Tips

- **Build time:** rust/java/.NET builds on the API droplet are slow at
  `s-2vcpu-2gb`; use `api_size = "s-4vcpu-8gb"` in tfvars if patience is short.
- **Lock down SSH:** once you know your IP, set `ssh_source_cidrs =
  ["<your-ip>/32"]`.
- **k6 results** also stay on the k6 droplet under
  `/opt/apicomp/infra/metrics/<stack>.md`.
- Local short-run parity: `just up rust` + `just smoke rust` + `just bench rust`
  still hit `http://localhost` — the DO rig is only for the off-box, two-VPS
  variant.

## Tear down

```bash
just tf destroy        # both droplets + firewall (Postgres volume included)
```

See also: `infra/do_deploy.py` (droplet-side stack swap), `infra/do_bench.py`
(the run orchestrator), `infra/compose.py` (the `-f` file-selection helper).