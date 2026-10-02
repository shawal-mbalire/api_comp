// k6 virtual-user workload — mirrors the video's experiment.
//
// One "user" is a loop over 4 actions with realistic 3–7 s pacing between them:
//   1. load feed          GET  /api/feed
//   2. open a post        GET  /api/posts/{id}
//   3. like a post        POST /api/posts/{id}/like
//   4. create a post      POST /api/posts
//
// The acting user id is derived from the VU number (VU 1..N are stable users),
// passed as `Authorization: Bearer <id>` — see api-contract.md.
//
// Run via the runner (benchmark.py) which drives VUs/duration and
// evaluates the pass criteria: P95 < 500 ms, P99 < 1 s, error rate < 1%.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const POST_COUNT = Number(__ENV.POST_COUNT || 500000); // matches seed defaults
const TOTAL_ACTING_USERS = Number(__ENV.TOTAL_ACTING_USERS || 50000);

export const options = {
  discardResponseBodies: false,
};

const WORDS = [
  'build', 'deploy', 'benchmark', 'server', 'latency', 'p95', 'p99', 'query',
  'pool', 'index', 'throughput', 'rps', 'feed', 'timeline', 'users', 'likes',
  'posts', 'threads', 'async', 'payload', 'edge', 'proxy', 'token', 'config',
];

function makePostContent() {
  const n = 4 + Math.floor(Math.random() * 6);
  const words = [];
  for (let i = 0; i < n; i++) words.push(WORDS[Math.floor(Math.random() * WORDS.length)]);
  return words.join(' ');
}

export default function () {
  // Stable acting user per VU, always within the seeded user range.
  const user = (__VU % TOTAL_ACTING_USERS) || TOTAL_ACTING_USERS;
  const headers = {
    Authorization: `Bearer ${user}`,
    'Content-Type': 'application/json',
  };

  // 1) Load user feed (20 newest posts + author + like counts)
  const feed = http.get(`${BASE_URL}/api/feed`, { headers });
  check(feed, { 'feed 200': (r) => r.status === 200 });
  sleep(3 + Math.random() * 4);

  // 2) Open a specific post
  const pid = 1 + Math.floor(Math.random() * POST_COUNT);
  const post = http.get(`${BASE_URL}/api/posts/${pid}`, { headers });
  check(post, { 'post 200': (r) => r.status === 200 });
  sleep(3 + Math.random() * 4);

  // 3) Like a post
  const like = http.post(`${BASE_URL}/api/posts/${pid}/like`, null, { headers });
  check(like, { 'like 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(3 + Math.random() * 4);

  // 4) Create a post
  const created = http.post(
    `${BASE_URL}/api/posts`,
    JSON.stringify({ content: makePostContent() }),
    { headers },
  );
  check(created, { 'create 201': (r) => r.status === 201 });
  sleep(3 + Math.random() * 4);
}