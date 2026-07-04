# Food API load test (k6)

Drives the deployed food API through the realistic **search → add-by-name → poll-status** journey as a
pool of **distinct Clerk users**, holds at the supported rate, then ramps past it to find where the
throttle saturates — recording sustained throughput and how it degrades. See the plan:
`docs/plans/2026-07-03-001-feat-food-api-load-test-plan.md`.

## ⚠️ Safety — read before running

- **Shared sandbox.** Targets the live shared sandbox RDS/instance that other previews use. Keep rates
  modest; this is a measurement, not a stress-to-break.
- **Real USDA burn.** Every `add-by-name` that misses cache hits the **paid** USDA API. A big/long run
  spends real quota. Start small.
- **Test users.** The provisioner creates real Clerk users (`loadtest+…@example.com`). Always run the
  teardown (or `run.mjs`) so they don't accumulate.
- `tokens.json` / `pool.json` hold live session JWTs — **secrets, gitignored, never commit.**

## Prerequisites

- [`k6`](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed (the load engine).
- Node 24 (the provisioner/orchestrator).
- AWS credentials for the sandbox account (to read the Clerk backend secret + CloudWatch for U2).
- A deployed, healthy food preview (e.g. `food-pr-59.commise.app`) — `GET /health` → 200.

## Run

```bash
cd scripts/loadtest
cp config.example.env config.env         # then edit knobs (target host, pool size, stage rates/thresholds)

# Clerk backend secret (mints the distinct-user token pool):
export CLERK_SECRET_KEY=$(aws secretsmanager get-secret-value \
  --secret-id kitchensink/sandbox/identity/keys --query SecretString --output text \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['SECRET_KEY'])")

# 1. Provision the distinct-user token pool (writes tokens.json + pool.json).
POOL_SIZE=20 node auth/provision-users.mjs

# 2. Run the journey (session JWTs are ~60s-lived — start k6 promptly after step 1).
k6 run --env FOOD_BASE_URL=https://food-pr-59.commise.app journey.js
```

`run.mjs` (U5) wraps all of this — provision → refresh the pool → k6 → collect server-side metrics (U2)
→ correlated report → teardown — into one repeatable command. (U2/U5 in progress.)

## Layout

```text
auth/provision-users.mjs   U1 — mint N Clerk users + session tokens → tokens.json / pool.json
corpus/food-queries.json   U3 — 113 varied, USDA-resolvable food queries
journey.js                 U4 — the k6 script (search → add → poll), staged profile, thresholds
config.example.env         tunables (target, pool size, stage rates/durations, SC-hold thresholds)
observe/collect-metrics.mjs  U2 — poll admin endpoints + CloudWatch over the run window  (todo)
auth/grant-admin.mjs         U2 — grant food:admin to one observer user                   (todo)
run.mjs                      U5 — orchestrate setup → k6 → observe → report → teardown     (todo)
```

## Metrics

`journey.js` emits, beyond k6's built-ins: `food_search_latency`, `food_add_accept_latency`,
`food_poll_to_terminal`, `food_reached_terminal` (share of adds reaching a terminal state within the poll
timeout — the throttle-backlog signal), `food_terminal_status{status}` (RESOLVED/UNRESOLVED/NOT_FOUND/
FAILED mix), and `food_auth_shed_503` tagged separately from `food_unexpected_5xx` (graceful backpressure
vs real failures). SC-hold is encoded as k6 `thresholds` — the run fails if breached.
