set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments := true

root := justfile_directory()

default:
    @just --list

# ── lifecycle ────────────────────────────────────────────────────────────────
# Launch EVERYTHING (Traefik + Postgres + all 8 stacks, images built inline).
up:
    @docker compose up -d --build

build:
    @docker compose build

down:
    @docker compose down

stop:
    @docker compose stop

ps:
    @docker compose ps

logs:
    @docker compose logs -f --tail=100

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

# ── tests ────────────────────────────────────────────────────────────────────
# Typecheck the TypeScript stacks (tsc --noEmit; no emit step — Node 24+
# type-stripping and Bun run the .ts files natively).
typecheck:
    #!/usr/bin/env python3
    import subprocess, sys

    stacks = ["ts-express", "ts-hono"]
    failed = 0
    for stack in stacks:
        r = subprocess.run(["npx", "tsc", "--noEmit"], cwd=stack)
        ok = r.returncode == 0
        print(f"{stack:16} {'ok' if ok else 'FAIL'}")
        failed += 0 if ok else 1
    print("typecheck: " + ("all stacks PASS" if failed == 0 else "FAILED"))
    raise SystemExit(1 if failed else 0)

# Unit tests per stack (fake repositories, no DB). `just test` → all stacks.
test stack="all":
    #!/usr/bin/env python3
    import subprocess, sys
    from concurrent.futures import ThreadPoolExecutor

    all_stacks = {
        "node":    ("ts-express",        ["node", "--test", "tests/"]),
        "bun":     ("ts-hono",           ["bun", "test", "tests/"]),
        "go":      ("go-gin",            ["go", "test", "./..."]),
        "rust":    ("rust-axum",         ["cargo", "test"]),
        "java":    ("java-spring",       ["mvn", "-q", "test"]),
        "fastapi": ("python-fastapi",    ["python3", "-m", "unittest", "tests.test_workflows"]),
        "dotnet":  ("cs-dotnet",         ["dotnet", "test"]),
        "php":     ("php-laravel",       None),  # needs dev deps (phpunit) in a full Laravel env
    }
    requested = sys.argv[1] if len(sys.argv) > 1 else "all"
    targets = all_stacks if requested == "all" else {requested: all_stacks[requested]}

    def run(item):
        name, (dir_, cmd) = item
        if cmd is None:
            return name, "SKIP"
        p = subprocess.run(cmd, cwd=dir_)
        return name, p.returncode

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(run, targets.items()))
    for name, code in results:
        if code == 0:
            print(f"{name:10} ok")
        elif code == "SKIP":
            print(f"{name:10} SKIP")
        else:
            print(f"{name:10} FAIL({code})")
    failed = [r for r in results if isinstance(r[1], int) and r[1] != 0]
    raise SystemExit(1 if failed else 0)