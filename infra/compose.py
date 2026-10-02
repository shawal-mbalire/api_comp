#!/usr/bin/env python3
"""
Compose helper: run `docker compose` against a SELECTED subset of stacks.

The repo root's docker-compose.yml is an aggregator (include: compose/base.yml
+ all 8 stack files), so a plain `docker compose up -d --build` still starts
everything. Under the hood the per-stack pieces are separate files so you can
run any subset:

    python3 infra/compose.py up -d --build            # everything
    python3 infra/compose.py up -d --build rust       # infra + rust only
    python3 infra/compose.py up -d --build go java    # infra + go + java
    python3 infra/compose.py down rust                # stop infra + rust
    python3 infra/compose.py ps

Stack-name tokens are pulled out of the command line; everything else is
passed straight to `docker compose`. The project is always `api-comp`
(compose/base.yml pins it), so Traefik discovery and the shared Postgres
volume behave identically across all invocation styles.

The justfile wraps this (`just up rust go`, `just down rust`, ...); the
DigitalOcean deploy machinery (infra/do_deploy.py) imports the same helpers.
"""
from __future__ import annotations

import itertools
import os
import pathlib
import subprocess
import sys

STACKS = ["rust", "go", "java", "dotnet", "bun", "node", "fastapi", "php"]
BASE = "compose/base.yml"
REPO = pathlib.Path(__file__).resolve().parent.parent


def stack_files(stacks: list[str]) -> list[str]:
    """compose/base.yml + one compose file per requested stack (all if empty)."""
    chosen = stacks or STACKS
    unknown = [s for s in chosen if s not in STACKS]
    if unknown:
        raise SystemExit(f"unknown stack(s): {', '.join(unknown)} — choose from {', '.join(STACKS)}")
    return [BASE] + [f"compose/{s}.yml" for s in chosen]


def compose_command(stacks: list[str], *args: str, cwd: str | None = None) -> list[str]:
    """`docker compose -f <files...> <args...>` run from the repo root."""
    files = stack_files(stacks)
    flags = list(itertools.chain.from_iterable(["-f", f] for f in files))
    return ["docker", "compose", *flags, *args]


def run(stacks: list[str], *args: str) -> int:
    cmd = compose_command(stacks, *args, cwd=str(REPO))
    return subprocess.call(cmd, cwd=REPO)


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if args and args[0] in ("-h", "--help") else 2

    stacks = [a for a in args if a in STACKS]
    rest = [a for a in args if a not in STACKS]
    return run(stacks, *rest)


if __name__ == "__main__":
    sys.exit(main())