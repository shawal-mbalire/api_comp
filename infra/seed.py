#!/usr/bin/env python3
"""Seed the benchmark database end-to-end (no shell — the whole pipeline).

  1. `docker compose up -d db` and wait until healthy
  2. generate the dataset CSVs (50k users / 500k posts / 2M likes by default)
  3. stream them into Postgres via COPY through psql inside the db container
  4. ANALYZE and print row counts

Usage:  python3 infra/seed.py [--users 50000] [--posts 500000] [--likes 2000000]
Requires: docker compose (project root), python3. No Node/sh/bash involved.

The schema is applied idempotently (it is also auto-loaded by the Postgres
image on a fresh volume from infra/schema.sql).
"""
from __future__ import annotations

import argparse
import datetime
import os
import pathlib
import random
import subprocess
import sys
import time

REPO = pathlib.Path(__file__).resolve().parent.parent
INFRA = pathlib.Path(__file__).resolve().parent
DATA_DIR = INFRA / "data"
SCHEMA = INFRA / "schema.sql"

WORDS = [
    "build", "deploy", "benchmark", "server", "latency", "p95", "p99", "database",
    "postgres", "connection", "pool", "query", "index", "throughput", "rps", "hash",
    "cache", "burn", "loop", "feed", "timeline", "users", "likes", "posts", "threads",
    "garbage", "collector", "async", "await", "buffer", "packet", "syntax", "schema",
    "config", "proxy", "edge", "ingress", "token", "auth", "websocket", "grpc", "rest",
    "json", "serialize", "compile", "traffic", "vps", "shared", "cpu", "memory", "disk",
    "spin", "socket", "satellite", "galaxy", "vector", "pixel", "quartz", "ember",
    "pipeline", "queue", "metric", "dashboard", "alert", "prometheus", "otel", "trace",
]


def mulberry32(seed: int):
    """Deterministic PRNG (same stream as the original Node generator)."""
    a = seed

    def rand() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rand


def iso(ms: int) -> str:
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def fake_content(rand) -> str:
    n = 8 + int(rand() * 24)
    words = [WORDS[int(rand() * len(WORDS))] for _ in range(n)]
    return " ".join(words)


def generate(users: int, posts: int, likes: int, seed: int, out_dir: pathlib.Path):
    rnd = mulberry32(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    now = int(time.time() * 1000)
    day = 24 * 60 * 60 * 1000
    user_start = now - 400 * day
    post_window = 90 * day

    with open(out_dir / "users.csv", "w") as f:
        for i in range(1, users + 1):
            created = iso(user_start + int(rnd() * 400 * day))
            f.write(f"{i},user_{i:06d},"
                    f"{WORDS[int(rnd()*len(WORDS))]} {WORDS[int(rnd()*len(WORDS))]},"
                    f"{created}\n")

    with open(out_dir / "posts.csv", "w") as f:
        for i in range(1, posts + 1):
            user_id = 1 + int(rnd() * users)
            posted = iso(now - int(rnd() * post_window))
            # CSV-safe: no quotes/commas/newlines in content
            f.write(f"{user_id},{fake_content(rnd)},{posted}\n")

    with open(out_dir / "likes.csv", "w") as f:
        seen = set()
        written = 0
        while written < likes:
            u = 1 + int(rnd() * users)
            p = 1 + int(rnd() * posts)
            key = (u << 20) ^ p
            if key in seen:
                continue
            seen.add(key)
            written += 1
            f.write(f"{u},{p},{iso(now - int(rnd() * post_window))}\n")

    print(f"generated {users} users / {posts} posts / {likes} likes in {out_dir}")


def dc(cmd: list[str], **kw):
    """Run docker compose from the repo root."""
    kw.setdefault("cwd", REPO)
    return subprocess.run(["docker", "compose", *cmd], **kw)


def db_psql(args: list[str] | None = None, stdin_bytes: bytes | None = None, **kw):
    base = ["docker", "compose", "exec", "-T", "db", "psql", "-U", "app", "-d", "app",
            "-v", "ON_ERROR_STOP=1", "-q"]
    return subprocess.run(base + (args or []), input=stdin_bytes, cwd=REPO, **kw)


def wait_healthy(timeout_s: int = 90) -> None:
    for _ in range(timeout_s):
        r = dc(["exec", "-T", "db", "pg_isready", "-U", "app", "-d", "app"],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode == 0:
            return
        time.sleep(1)
    raise SystemExit("db did not become healthy in time")


def load(table_cols: str, csv_path: pathlib.Path) -> None:
    copy_sql = f"\\copy {table_cols} FROM '/dev/stdin' WITH (FORMAT csv)"
    with open(csv_path, "rb") as fh:
        r = db_psql(["-c", copy_sql], stdin_bytes=fh.read())
    if r.returncode != 0:
        raise SystemExit(f"COPY {table_cols} failed")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--users", type=int, default=50000)
    ap.add_argument("--posts", type=int, default=500000)
    ap.add_argument("--likes", type=int, default=2000000)
    ap.add_argument("--out", type=pathlib.Path, default=DATA_DIR)
    ap.add_argument("--seed", type=int, default=int(os.getenv("SEED", "1337")))
    args = ap.parse_args()

    dc(["up", "-d", "db"], check=True)
    wait_healthy()
    generate(args.users, args.posts, args.likes, args.seed, args.out)

    print("applying schema (idempotent)…")
    db_psql(["-f", "/dev/stdin"], stdin_bytes=SCHEMA.read_bytes(), check=True)

    print("truncating tables for a clean reload…")
    db_psql(["-c", "TRUNCATE users, posts, likes RESTART IDENTITY CASCADE;"], check=True)

    load("users (id, username, display_name, created_at)", args.out / "users.csv")
    load("posts (user_id, content, posted_at)", args.out / "posts.csv")
    load("likes (user_id, post_id, created_at)", args.out / "likes.csv")

    db_psql(["-c", "ANALYZE users; ANALYZE posts; ANALYZE likes;"], check=True)
    r = db_psql(["-c", "SELECT (SELECT count(*) FROM users) users, "
                       "(SELECT count(*) FROM posts) posts, "
                       "(SELECT count(*) FROM likes) likes;"],
                stdout=subprocess.PIPE, text=True)
    print(r.stdout)
    print("seed complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())