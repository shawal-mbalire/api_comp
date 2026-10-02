#!/usr/bin/env python3
"""Deploy a single API stack to a Docker host (the DigitalOcean API droplet).

Topology: the DigitalOcean setup uses exactly TWO droplets — an API droplet
that runs ONE stack at a time (Traefik + Postgres + a single service, swapped
per benchmark run) and a k6 droplet that generates the load. This script is the
API-droplet side of that swap:

  1. stop + remove every previously deployed stack container (so exactly one
     API is reachable at a time)
  2. seed Postgres once (the dataset lives in the pgdata volume and survives
     stack swaps)
  3. build + start base infra (Traefik + Postgres) + the selected stack
  4. wait until Traefik routes /<stack>/health

Usage (run from the repo root, as the Terraform api_deploy provisioner does):

    python3 infra/do_deploy.py --stack rust [--seed]

Requires: docker + the compose plugin on PATH, this repo checked out on disk.
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "infra"))

import compose  # noqa: E402  — infra/compose.py, same helpers as the justfile

WAIT_STEPS = 60          # 5 s apart -> up to 5 minutes for slow first builds
WAIT_SLEEP = 5.0


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, **kw)


def wait_health(stack: str) -> None:
    url = f"http://127.0.0.1/{stack}/health"
    for _ in range(WAIT_STEPS):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    print(f"  healthy: {url}")
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(WAIT_SLEEP)
    raise SystemExit(f"stack {stack} did not become healthy at {url} in time")


def deploy(stack: str, seed: bool) -> int:
    print(f"[do_deploy] swapping API droplet to a single stack: {stack}  (seed={seed})")

    # A fresh clone has no acme.json (gitignored); Traefik needs it to be a
    # FILE or the bind mount becomes a directory and Let's Encrypt storage
    # startup breaks (harmless locally where it already exists).
    acme = REPO / "infra" / "acme.json"
    acme.parent.mkdir(parents=True, exist_ok=True)
    acme.touch(exist_ok=True)

    # 1) remove every previously deployed API so EXACTLY ONE runs at a time;
    #    --remove-orphans sweeps the previous stack's container. Named volumes
    #    (pgdata) survive `down`, so the seed dataset carries across swaps.
    sh(compose.compose_command([stack], "down", "--remove-orphans"), check=True)

    # 2) seed Postgres once (seed.py brings the db up itself; the schema is
    #    applied idempotently and the volume persists across stack swaps).
    if seed:
        sh(["python3", "infra/seed.py"], check=True)

    # 3) build + start infra and the selected stack under Traefik.
    sh(compose.compose_command([stack], "up", "-d", "--build"), check=True)

    # 4) wait until Traefik routes the stack's /health.
    wait_health(stack)

    sh(compose.compose_command([stack], "ps"))
    print(f"[do_deploy] {stack} is live behind Traefik")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stack", required=True, choices=compose.STACKS,
                    help="single API stack to run on this droplet")
    ap.add_argument("--seed", action="store_true",
                    help="seed Postgres before starting (one-time; volume persists afterwards)")
    args = ap.parse_args(argv)
    return deploy(args.stack, args.seed)


if __name__ == "__main__":
    sys.exit(main())