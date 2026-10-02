#!/usr/bin/env python3
"""Run one full OFF-BOX benchmark for a stack on the DigitalOcean setup.

Topology — exactly 2 droplets at any time:
  - API droplet : Traefik + Postgres + ONE stack, swapped per benchmark run
  - k6 droplet  : runs k6 (infra/traffic/benchmark.js via benchmark.py)
                  pointed at the API droplet's public IP (off-box traffic)

Pipeline per stack:
  1. terraform apply -var stack=<stack>     (swap the API droplet to this stack)
  2. ssh k6 : refresh repo + contract smoke test against http://<api-ip>/<stack>
  3. ssh k6 : python3 infra/benchmark.py --stack <stack> --base-url http://<api-ip>
  4. scp    : pull infra/metrics/<stack>.md back to the local machine

Usage:
    python3 infra/do_bench.py --stack rust
    python3 infra/do_bench.py --stack rust --no-apply --skip-smoke

Env:
    DO_SSH_KEY  local private key for the droplets (default ~/.ssh/id_ed25519)
    REPO_REF    ref checked out on the k6 droplet (default: terraform's repo_ref)
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
TF_DIR = REPO / "terraform"
REMOTE = "/opt/apicomp"
METRICS = REPO / "infra" / "metrics"
STACKS = ["rust", "go", "java", "dotnet", "bun", "node", "fastapi", "php"]


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd))
    return subprocess.run(cmd, **kw)


def ssh_cmd(key: str, host: str, remote: str) -> list[str]:
    """ssh root@<host> '<remote>' — the droplets use key-based root login."""
    return [
        "ssh", "-i", key,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=30",
        f"root@{host}", remote,
    ]


def tf(outputs: bool = False, *args: str):
    cmd = ["terraform", "-chdir=" + str(TF_DIR), *args]
    return sh(cmd, capture_output=True, text=True) if outputs else sh(cmd)


def tf_outputs() -> dict:
    r = tf(True, "output", "-json")
    if r.returncode != 0:
        print(r.stdout + r.stderr)
        raise SystemExit("terraform output failed — run `just tf apply` first")
    return json.loads(r.stdout)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stack", required=True, choices=STACKS)
    ap.add_argument("--no-apply", action="store_true",
                    help="skip `terraform apply` (API droplet already on this stack)")
    ap.add_argument("--skip-smoke", action="store_true",
                    help="skip the 14-check contract smoke test before benchmarking")
    args = ap.parse_args(argv)
    stack = args.stack

    key = os.path.expanduser(os.environ.get("DO_SSH_KEY", "~/.ssh/id_ed25519"))
    if not os.path.exists(key):
        raise SystemExit(f"SSH private key not found: {key} (set DO_SSH_KEY)")

    # 1) swap the API droplet to this stack (api_deploy null_resource re-runs).
    if not args.no_apply:
        r = tf(False, "apply", "-auto-approve", "-var", f"stack={stack}")
        if r.returncode != 0:
            return r.returncode

    out = tf_outputs()
    api_ip = out["api_ip"]["value"]
    k6_ip = out["k6_ip"]["value"]
    ref = os.environ.get("REPO_REF", out["repo_ref"]["value"])
    base = f"http://{api_ip}"
    print(f"[do_bench] API droplet http://{api_ip}  |  k6 droplet {k6_ip}  (ref {ref})")

    # Fresh repo on the k6 droplet at the same ref terraform deployed.
    refresh = (
        f"cd {REMOTE} && git fetch --all "
        f"&& git checkout {ref} && git reset --hard {ref}"
    )
    r = sh(ssh_cmd(key, k6_ip, refresh))
    if r.returncode != 0:
        return r.returncode

    # 2) contract conformance from the k6 droplet against the API droplet.
    if not args.skip_smoke:
        smoke = f"cd {REMOTE} && python3 infra/smoke-test.py --base-url {base}/{stack}"
        r = sh(ssh_cmd(key, k6_ip, smoke))
        if r.returncode != 0:
            print(f"[do_bench] smoke test FAILED for {stack} — fix before benchmarking")
            return r.returncode

    # 3) the full binary-search benchmark, off-box.
    bench = f"cd {REMOTE} && python3 infra/benchmark.py --stack {stack} --base-url {base}"
    r = sh(ssh_cmd(key, k6_ip, bench))
    if r.returncode != 0:
        print(f"[do_bench] benchmark FAILED for {stack}")
        return r.returncode

    # 4) pull the report back (it also stays on the k6 droplet).
    METRICS.mkdir(parents=True, exist_ok=True)
    report = f"{REMOTE}/infra/metrics/{stack}.md"
    r = sh(["scp", "-i", key, "-o", "StrictHostKeyChecking=accept-new",
            f"root@{k6_ip}:{report}", str(METRICS / f"{stack}.md")])
    if r.returncode != 0:
        print(f"[do_bench] could not copy {report} back — fetch it manually")
    else:
        print(f"[do_bench] report -> infra/metrics/{stack}.md")

    print(f"[do_bench] {stack} run complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())