#!/usr/bin/env python3
"""
Binary-search benchmark runner for the API language/framework comparison.

Reproduces the video's protocol:
  1. Warm-up run at 1,000 users.
  2. 2-minute runs starting at 2,500 users, doubling until a stack fails,
     then a binary search for the exact failing/passing boundary.
  3. Mandatory 5-minute confirmation run at the found peak (catches slow
     degradation, e.g. Node dropping 3,750 -> 3,250 under sustained load).

Pass criteria (a stack FAILS if any is violated):
  - P95 latency < 500 ms
  - P99 latency < 1.0 s
  - error rate  < 1%

Usage:
    benchmark.py --stack go [--initial 2500] [--base-url http://localhost]
    benchmark.py --stack rust --confirm-only 12500

Requires `k6` on PATH and the target stack running
(`docker compose up -d --build`; each stack is served under its /<stack> prefix).
"""

import argparse
import json
import math
import os
import subprocess
import sys

SCRIPT = "infra/traffic/benchmark.js"
RESULTS_DIR = "infra/metrics"

P95_MAX = 500.0
P99_MAX = 1000.0
ERR_MAX = 0.01  # 1%


def run_k6(base_url, users, duration, tag):
    os.makedirs(RESULTS_DIR, exist_ok=True)
    out = os.path.join(RESULTS_DIR, f"{tag}.summary.json")
    cmd = [
        "k6", "run", "--quiet", "--summary-export", out,
        "--summary-trend-stats=avg,min,med,max,p(90),p(95),p(99)",
        "-u", str(users), "-d", duration,
        "-e", f"BASE_URL={base_url}",
        SCRIPT,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("[k6] failed:")
        print((r.stdout + r.stderr)[-3000:])
        return None
    with open(out) as fh:
        data = json.load(fh)
    m = data["metrics"]
    dur = m["http_req_duration"]
    # k6 <2.3 nests under "values"; k6 >=2.3 flattens onto the metric object.
    vals = dur.get("values") or dur
    failed = m["http_req_failed"]
    err = (failed.get("values") or failed).get("value", 0.0)
    return {
        "users": users,
        "p95": vals["p(95)"],
        "p99": vals["p(99)"],
        "err": float(err),  # http_req_failed value == failure rate (0..1) in k6>=2.3
        "rps": m["http_reqs"]["rate"],
        "file": out,
    }


def passed(m):
    return m is not None and m["p95"] < P95_MAX and m["p99"] < P99_MAX and m["err"] < ERR_MAX


def pretty(m):
    if m is None:
        return "CRASHED"
    return (
        f"{m['users']:>6} users  p95={m['p95']:7.1f}ms  "
        f"p99={m['p99']:8.1f}ms  err={m['err']*100:5.2f}%  rps={m['rps']:7.1f}  -> {'PASS' if passed(m) else 'FAIL'}"
    )


def binary_search(base_url, lo, hi, tag_prefix):
    """Find the highest passing user count in (lo, hi] using 2-min runs."""
    best = lo
    while hi - best > 1:
        mid = (best + hi) // 2
        m = run_k6(base_url, mid, "2m", f"{tag_prefix}_{mid}")
        print(f"  [2m] {pretty(m)}")
        if passed(m):
            best = mid
        else:
            hi = mid
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stack", required=True, help="Stack name (go, rust, node, ...)")
    ap.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost"), help="Nginx edge URL")
    ap.add_argument("--initial", type=int, default=2500, help="Starting user count (default 2500)")
    ap.add_argument("--max-users", type=int, default=32000, help="Upper bound for doubling")
    ap.add_argument("--min-users", type=int, default=125)
    ap.add_argument("--skip-warmup", action="store_true")
    ap.add_argument("--confirm-only", type=int, default=None, help="Skip search; confirm a specific user count")
    args = ap.parse_args()

    # Traefik routes each stack under its own path prefix (e.g. /go, /rust)
    # and strips it before the backend — so the API contract URIs are identical.
    target = f"{args.base_url.rstrip('/')}/{args.stack}"

    tag = f"{args.stack}_{int(time_now())}"
    history = []

    if not args.skip_warmup:
        w = run_k6(target, 1000, "1m30s", f"{args.stack}_warmup_1000")
        print(f"[warm] {pretty(w)}")

    if args.confirm_only is not None:
        peak = args.confirm_only
    else:
        print(f"[search] exponential climb from {args.initial} (cap {args.max_users})")
        level = args.initial
        last = None
        while level <= args.max_users:
            last = run_k6(target, level, "2m", f"{tag}_{level}")
            print(f"  [2m] {pretty(last)}")
            history.append(last)
            if not passed(last):
                break
            level *= 2
        else:
            peak = level // 2
            print(f"[skip] passed all the way to {level // 2} users (cap reached)")
            peak = level // 2
            m = run_k6(target, peak, "5m", f"{tag}_confirm_{peak}")
            print(f"[5m ] {pretty(m)}")
            return summarize(args.stack, history + [m])

        if last is None:
            sys.exit("initial run failed to produce metrics")
        if history[0] and not passed(history[0]):
            # Even the starting level fails: walk down to find a pass.
            level = args.initial
            while level >= args.min_users:
                m = run_k6(target, level, "2m", f"{tag}_{level}")
                print(f"  [2m] {pretty(m)}")
                history.append(m)
                if passed(m):
                    break
                level //= 2
            else:
                print("FAILED below", args.min_users, "users")
                return summarize(args.stack, history)
            peak = level
        else:
            hi = last["users"]
            lo = max([h["users"] for h in history if passed(h)] + [0])
            print(f"[search] binary search between {lo} (pass) and {hi} (fail)")
            peak = binary_search(target, lo, hi, tag)

    # ---- mandatory 5-minute confirmation run at the found peak ----
    m = run_k6(target, peak, "5m", f"{tag}_confirm_{peak}")
    print(f"[5m ] {pretty(m)}")
    history.append(m)

    while m is not None and not passed(m) and peak > args.min_users:
        # Sustained load exposes degradation short runs miss -> walk down.
        peak //= 2
        m = run_k6(target, peak, "5m", f"{tag}_confirm_{peak}")
        print(f"[5m ] retry at {peak}: {pretty(m)}")
        history.append(m)

    return summarize(args.stack, history + [m])


def time_now():
    import time
    return int(time.time())


def summarize(stack, history):
    finals = [m for m in history if m is not None and passed(m)]
    if not finals:
        print(f"\n{stack}: no passing user level found.")
        return 1
    peak = max(finals, key=lambda m: m["users"])
    print(f"\n=== RESULT ({stack}) === peak sustained users: {peak['users']} "
          f"(p95 {peak['p95']:.1f}ms, p99 {peak['p99']:.1f}ms, err {peak['err']*100:.2f}%)")
    # Write a report row
    os.makedirs(RESULTS_DIR, exist_ok=True)
    report = os.path.join(RESULTS_DIR, f"{stack}.md")
    with open(report, "w") as fh:
        fh.write(f"# {stack} result\n\n")
        fh.write(f"- Peak sustained users (5-min confirm): **{peak['users']}**\n")
        fh.write(f"- RPS at peak: **{peak['rps']:.1f}**\n")
        fh.write(f"- P95: {peak['p95']:.1f} ms | P99: {peak['p99']:.1f} ms | Errors: {peak['err']*100:.2f}%\n\n")
        fh.write("| users | p95 (ms) | p99 (ms) | err % | rps | verdict |\n|---|---|---|---|---|---|\n")
        for m in history:
            if m is None:
                continue
            verdict = "PASS" if passed(m) else "FAIL"
            fh.write(f"| {m['users']} | {m['p95']:.1f} | {m['p99']:.1f} | {m['err']*100:.2f} | {m['rps']:.1f} | {verdict} |\n")
    print(f"Report written to {report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())