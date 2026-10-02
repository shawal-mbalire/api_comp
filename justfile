set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments := true

root := justfile_directory()

default:
    @just --list

# ── lifecycle ────────────────────────────────────────────────────────────────
# Launch EVERYTHING (Traefik + Postgres + all 8 stacks). Append stack names to
# run a SUBSET instead — every stack is its own compose file under the same
# `api-comp` project, so Traefik discovery and the shared Postgres volume just
# work:
#   just up                # everything
#   just up rust go        # infra + rust + go
#   just build php         # build one stack only
#   just down rust         # stop infra + rust (pgdata volume persists)
up *stacks:
    @python3 infra/compose.py up -d --build {{stacks}}

build *stacks:
    @python3 infra/compose.py build {{stacks}}

down *stacks:
    @python3 infra/compose.py down {{stacks}}

stop *stacks:
    @python3 infra/compose.py stop {{stacks}}

ps *stacks:
    @python3 infra/compose.py ps {{stacks}}

logs *stacks:
    @python3 infra/compose.py logs -f --tail=100 {{stacks}}

# ── database ─────────────────────────────────────────────────────────────────
seed:
    @python3 infra/seed.py

# ── traffic / metrics ────────────────────────────────────────────────────────
# Smoke-test one stack's contract conformance (14 checks) via Traefik prefix.
smoke stack:
    @python3 infra/smoke-test.py --base-url http://localhost/{{stack}}

# Smoke-test all 8 stacks concurrently and summarize the results.
check:
    #!/usr/bin/env python3
    import subprocess
    from concurrent.futures import ThreadPoolExecutor

    stacks = ["rust", "go", "java", "dotnet", "bun", "node", "fastapi", "php"]

    def run(s: str):
        return s, subprocess.run(
            ["python3", "infra/smoke-test.py", "--base-url", f"http://localhost/{s}"],
        ).returncode

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, stacks))

    ok = [s for s, c in results if c == 0]
    bad = [(s, c) for s, c in results if c != 0]
    print("\nsmoke check: " + ("✓ " + " ".join(ok) if ok else ""))
    if bad:
        print("  ✗ FAILED:", bad)
        raise SystemExit(1)
    print("  all stacks PASS")

# Binary-search benchmark of one stack (warm-up → 2-min search → 5-min confirm).
bench stack:
    @python3 infra/benchmark.py --stack {{stack}}

# List collected metrics (per-stack reports + k6 summaries).
metrics:
    @ls -la infra/metrics 2>/dev/null || echo "no metrics yet — run: just bench <stack>"

# ── digital ocean (terraform) ────────────────────────────────────────────────
# Two droplets: apicomp-api runs ONE stack at a time (Traefik + Postgres +
# one API) and apicomp-k6 runs k6 against the API droplet's public IP
# (off-box traffic, exactly 2 droplets at any time). See terraform/README.md.
# Raw terraform passthrough (cwd = terraform/):
#   just tf init | plan | apply | destroy | output
tf *args:
    @cd {{root}}/terraform && terraform {{args}}

# Swap the API droplet to <stack>, then run the 14-check smoke test + the full
# binary-search benchmark from the k6 droplet, and pull the report back.
bench-do stack:
    @python3 {{root}}/infra/do_bench.py --stack {{stack}}

# Run each of the 8 API setups exactly once against the same two droplets.
bench-do-all:
    #!/usr/bin/env python3
    import os
    import sys

    sys.path.insert(0, os.path.join("{{root}}", "infra"))
    from do_bench import main

    failed = 0
    for s in ["rust", "go", "java", "dotnet", "bun", "node", "fastapi", "php"]:
        print(f"\n=== benchmark {s} ===")
        code = main(["--stack", s])
        failed += 1 if code else 0
        print(f"{s}: {'PASS' if code == 0 else 'FAIL(' + str(code) + ')'}")
    print(f"\nbench-do-all: {'all stacks PASS' if failed == 0 else str(failed) + ' FAILED'}")
    raise SystemExit(1 if failed else 0)

# ── per-stack router: just <stack> <recipe> ─────────────────────────────────
# Every stack folder ships its own self-contained justfile (build/test/typecheck/
# start/...). `just rust` lists it; `just rust test` runs cargo test in rust-axum/.
rust recipe="default" *args:
    @cd {{root}}/rust-axum && just {{recipe}} {{args}}

go recipe="default" *args:
    @cd {{root}}/go-gin && just {{recipe}} {{args}}

java recipe="default" *args:
    @cd {{root}}/java-spring && just {{recipe}} {{args}}

dotnet recipe="default" *args:
    @cd {{root}}/cs-dotnet && just {{recipe}} {{args}}

bun recipe="default" *args:
    @cd {{root}}/ts-hono && just {{recipe}} {{args}}

node recipe="default" *args:
    @cd {{root}}/ts-express && just {{recipe}} {{args}}

fastapi recipe="default" *args:
    @cd {{root}}/python-fastapi && just {{recipe}} {{args}}

php recipe="default" *args:
    @cd {{root}}/php-laravel && just {{recipe}} {{args}}

# ── tests ────────────────────────────────────────────────────────────────────
# Typecheck the TypeScript stacks via their own justfiles (tsc --noEmit; no emit
# step — Node 24+ type-stripping and Bun run the .ts files natively).
typecheck:
    #!/usr/bin/env python3
    import subprocess, sys

    stacks = ["ts-express", "ts-hono"]
    failed = 0
    for stack in stacks:
        r = subprocess.run(["just", "-f", f"{stack}/justfile", "typecheck"])
        ok = r.returncode == 0
        print(f"{stack:16} {'ok' if ok else 'FAIL'}")
        failed += 0 if ok else 1
    print("typecheck: " + ("all stacks PASS" if failed == 0 else "FAILED"))
    raise SystemExit(1 if failed else 0)

# Unit tests per stack through its own justfile (fake repositories, no DB).
# `just test` → all stacks; `just test rust` → one stack.
test stack="all":
    #!/usr/bin/env python3
    import subprocess, sys
    from concurrent.futures import ThreadPoolExecutor

    all_stacks = {
        "node":    "ts-express",
        "bun":     "ts-hono",
        "go":      "go-gin",
        "rust":    "rust-axum",
        "java":    "java-spring",
        "fastapi": "python-fastapi",
        "dotnet":  "cs-dotnet",   # needs a .NET SDK on the host
        "php":     "php-laravel", # child justfile SKIPs when vendor/phpunit is absent
    }
    requested = sys.argv[1] if len(sys.argv) > 1 else "all"
    targets = all_stacks if requested == "all" else {requested: all_stacks[requested]}

    def run(item):
        name, dir_ = item
        p = subprocess.run(["just", "-f", f"{dir_}/justfile", "test"])
        return name, p.returncode

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, targets.items()))
    for name, code in results:
        print(f"{name:10} {'ok' if code == 0 else f'FAIL({code})'}")
    failed = [r for r in results if r[1] != 0]
    raise SystemExit(1 if failed else 0)