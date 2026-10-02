#!/usr/bin/env python3
"""
Contract-conformance smoke test.

Hits every endpoint of a running stack and asserts it complies with
api-contract.md and openapi.yaml. Use before benchmarking a stack:

    smoke-test.py                                       # -> http://localhost (Traefik edge)
    smoke-test.py --base-url http://localhost:3000

Exits non-zero on any violation.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

FIELDS = ["id", "userId", "username", "displayName", "content", "postedAt", "likeCount"]
FAILED = []


def call(base, method, path, token=None, body=None):
    url = base + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token is not None:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return e.code, None


def check(name, cond, detail=""):
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name} {detail}")
        FAILED.append(name)


def iso_utc(s):
    if not isinstance(s, str) or "T" not in s or "Z" not in s and "+" not in s:
        return False
    return s.endswith("Z") or "+00:00" in s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    print(f"Smoke-testing {base}")

    # health (no auth)
    s, b = call(base, "GET", "/health")
    check("GET /health 200", s == 200 and b == {"status": "ok"}, f"got {s} {b}")

    # auth
    s, b = call(base, "GET", "/api/me")
    check("GET /api/me unauth 401", s == 401, f"got {s} {b}")

    # me
    s, b = call(base, "GET", "/api/me", token=1)
    me_ok = s == 200 and b and all(k in b for k in ("id", "username", "displayName"))
    check("GET /api/me 200", me_ok, f"got {s} {b}")

    # feed
    s, b = call(base, "GET", "/api/feed", token=1)
    feed_ok = s == 200 and isinstance(b, list) and len(b) == 20 and \
        all(isinstance(p, dict) and all(k in p for k in FIELDS) for p in b)
    check("GET /api/feed 200 + 20 posts + shape", feed_ok, f"got {s}, len {len(b) if isinstance(b, list) else 'n/a'}")
    if isinstance(b, list) and b:
        check("feed postedAt ISO-8601 Z", iso_utc(b[0]["postedAt"]), f"{b[0].get('postedAt')}")
        check("feed has author", isinstance(b[0]["username"], str) and b[0]["username"] != "")

    # single post
    s, b = call(base, "GET", "/api/posts/1", token=1)
    post_ok = s == 200 and isinstance(b, dict) and all(k in b for k in FIELDS)
    check("GET /api/posts/1 200", post_ok, f"got {s} {b}")
    s, b = call(base, "GET", "/api/posts/999999999", token=1)
    check("GET /api/posts/999999999 404", s == 404, f"got {s}")

    # like
    s, b = call(base, "POST", "/api/posts/1/like", token=2)
    check("POST like 204", s == 204, f"got {s}")
    s, b = call(base, "POST", "/api/posts/1/like", token=2)
    check("POST like idempotent 204", s == 204, f"got {s}")
    s, b = call(base, "POST", "/api/posts/999999999/like", token=2)
    check("POST like missing 404", s == 404, f"got {s}")

    # create
    s, b = call(base, "POST", "/api/posts", token=1, body={"content": "smoke test post"})
    create_ok = s == 201 and isinstance(b, dict) and all(k in b for k in FIELDS) \
        and b["content"] == "smoke test post" and b["likeCount"] == 0
    check("POST /api/posts 201", create_ok, f"got {s} {b}")
    s, b = call(base, "POST", "/api/posts", token=1, body={})
    check("POST /api/posts empty 400", s == 400, f"got {s}")
    s, b = call(base, "POST", "/api/posts", token=1, body={"content": "   "})
    check("POST /api/posts blank 400", s == 400, f"got {s}")

    if FAILED:
        print(f"\n{len(FAILED)} violation(s): {', '.join(FAILED)}")
        sys.exit(1)
    print("\nAll contract checks passed.")


if __name__ == "__main__":
    main()