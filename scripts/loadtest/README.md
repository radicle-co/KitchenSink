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

# 1. Provision the distinct-user pool (writes pool.json + tokens.json).
#    POOL_SIZE must be >= MAX_VUS (journey.js fails fast otherwise — VU i authenticates as user i).
POOL_SIZE=100 node auth/provision-users.mjs

# 2. Run the journey. journey.js loads pool.json and refreshes each VU's ~60s token in-run via FAPI,
#    so the run can last minutes without the tokens expiring.
k6 run --env FOOD_BASE_URL=https://food-pr-59.commise.app journey.js
```

`run.mjs` (U5) wraps all of this — provision → k6 → collect server-side metrics (U2) → correlated report
→ teardown — into one repeatable command. (U2/U5 in progress.)

**Token lifetime (important):** Clerk session JWTs are ~60s-lived. `journey.js` does NOT rely on a
static token file staying fresh — each VU re-mints its own token from FAPI before expiry (a k6
`SharedArray` is loaded once at init and can never receive a disk refresh). `FAPI`/`ORIGIN` in the config
must match what the provisioner used. If tokens ever do expire, the `food_auth_fail` threshold fails the
run loudly rather than silently measuring 401-rejection latency.

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

`journey.js` emits, beyond k6's built-ins: `food_search_latency` / `food_add_accept_latency` (recorded
**only for successful** 200/202 responses so failures can't deflate p95), `food_poll_to_terminal`,
`food_reached_terminal` (share of adds reaching a terminal state within the poll timeout — the
throttle-backlog signal), `food_terminal_status{status}` (RESOLVED/UNRESOLVED/NOT_FOUND/FAILED mix),
`food_auth_shed_503` (graceful backpressure), and the **rates** `food_unexpected_5xx` and
`food_auth_fail`. SC-hold is encoded as k6 `thresholds` (p95 latencies, `food_unexpected_5xx` rate,
`food_auth_fail` rate ~0, and a `dropped_iterations` cap so silent VU starvation fails the run).
