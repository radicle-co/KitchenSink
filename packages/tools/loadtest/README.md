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
- **Test users.** Nothing here creates a Clerk user. The run LEASES slots of the fixed test pool
  (`@kitchensink/e2e-fixtures/testPool`), which only `poolAdmin` provisions, and at most 20 VU slots exist —
  so `POOL_SIZE`/`MAX_VUS` cannot exceed 20.
- `tokens.json` / `pool.json` hold live session JWTs — **secrets, gitignored, never commit.**

This is the `@kitchensink/loadtest` workspace (`packages/tools/loadtest`); commands run from here.

## Prerequisites

- Node 24 + repo deps installed (`npm ci` at the repo root).
- `k6` — installed into this package via `npm run k6:install` (downloads the pinned binary into
  `node_modules/.bin`, so the npm scripts below find it). No global install needed.
- AWS credentials for the sandbox account (to read the Clerk backend secret + CloudWatch for U2).
- A deployed, healthy food preview — `GET /health` → 200. Resolve its origin from the stage
  (`node printPublicOrigin.mjs food pr-73 commise.app`); never type the host, it rots silently.

## Run

```bash
cd packages/tools/loadtest
npm run k6:install                       # one-time: fetch the k6 binary
cp config.example.env config.env         # then edit knobs (target host, pool size, stage rates/thresholds)

# Clerk backend secret (mints the distinct-user token pool):
export CLERK_SECRET_KEY=$(aws secretsmanager get-secret-value \
  --secret-id kitchensink/sandbox/identity/keys --query SecretString --output text \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['SECRET_KEY'])")

# One command — lease the pool → k6 + server-side collection → correlated report.md. The pool is the FIXED
# test pool; there is no teardown because a run creates no user:
POOL_SIZE=20 ORIGIN=<web origin> CLERK_PUBLISHABLE_KEY=<pk_test_…> \
  FOOD_BASE_URL="$(node printPublicOrigin.mjs food pr-73 commise.app)" npm run loadtest
```

Or the steps individually: `npm run provision:pool`, `npm run journey`, `npm run collect`
(`POOL_SIZE` must be `>= MAX_VUS` — `journey.js` fails fast otherwise, since VU `i` authenticates as user `i`).

### The pool is leased, never minted

`npm run provision:pool` LEASES up to 20 VU slots plus the `food:admin` slot of the fixed test pool: it looks
each up in Clerk, refuses a slot `poolAdmin` has not provisioned, signs in by ticket through the Frontend API
(so the token carries the `azp` the deployed guard requires) and stores the session handles, so the next run
re-mints instead of signing in again. `REUSE_POOL=1 npm run loadtest:reuse` skips the lease and reuses the
files. There is no sweep: a sweeper matching the pool is a sweeper that deletes it.

### USDA rate-limit stall→resume (`npm run ratelimit`)

Proves the load behavior: when the worker's USDA rolling window hits its cap it **pauses** (queue stalls),
then **resumes** once the window clears. Needs a preview deployed with a **low cap + short window** so it's
observable without 900+ real USDA calls or an hour's wait:

```bash
# deploy the food preview with a low cap + short window (CDK context; prod/normal deploys are unaffected):
npm run infra:deploy --workspace=packages/services/food-service -- -c stage=pr-59 \
  -c foodSourceRateLimitPerHour=15 -c foodSourceWindowSeconds=60
# then, from packages/tools/loadtest (persistent pool already provisioned):
WINDOW_SECONDS=60 BURST_COUNT=60 npm run ratelimit
```

`ratelimit.js` floods unique (cache-missing) adds to drive the window to the cap; `ratelimit.mjs` samples
the admin `/metrics` (`sources[usda].paused`/`utilization`) + `/queue` depth and prints a **verdict**:
STALL seen (worker paused at the cap, queue backed up) → RESUME seen (paused clears, queue drains).
Deterministic correctness of the same behavior lives in
`food-service/tests/foodConsumer.integration.test.ts` (`stall→resume`) — the load test demonstrates it end-to-end.

> **Promotion-by-request-count** (#2) and **flooding-user demotion/flood-shed** (#3) are queue-ordering
> invariants that only manifest under a backlog / near the depth ceiling — proven deterministically by
> `fetchQueue.dao`, `fairness-demotion`, and `admission` integration tests, not the k6 load test.

### Does the food really land in the DB?

Yes — with `VERIFY_PERSISTENCE=1` (default), when a food reaches a terminal state the journey reads the
USDA data **back from the DB** (the candidate set for `UNRESOLVED`, the golden record for `RESOLVED`) and
records `food_data_persisted`; a threshold (`rate>0.99`) **fails the run** if the sync→DB write is broken.

## Run in CI (GitHub Action)

Prefer not to run it locally? Trigger the **`Food API load test`** workflow
(`.github/workflows/food-loadtest.yml`): **Actions → Food API load test → Run workflow**, or:

```bash
gh workflow run food-loadtest.yml \
  -f target_stage=pr-73 \
  -f hold_rate=2 -f ramp_rate=3 -f pool_size=100 -f max_vus=100
```

It installs k6, resolves the Clerk secret/FAPI/azp for the stage from AWS, runs `run.mjs`, prints
`report.md` to the **job summary**, and uploads `report.md` + `k6-summary.json` + `server-metrics.json`
as artifacts. **Note:** GitHub only exposes a `workflow_dispatch` workflow once it is on the default
branch, so this becomes triggerable after the PR merges to `main`.

**Token lifetime (important):** Clerk session JWTs are ~60s-lived. `journey.js` does NOT rely on a
static token file staying fresh — each VU re-mints its own token from FAPI before expiry (a k6
`SharedArray` is loaded once at init and can never receive a disk refresh). `FAPI`/`ORIGIN` in the config
must match what the provisioner used. If tokens ever do expire, the `food_auth_fail` threshold fails the
run loudly rather than silently measuring 401-rejection latency.

## Layout

```text
package.json                 @kitchensink/loadtest — npm scripts (k6:install, loadtest, provision:pool, …)
installK6.mjs               downloads the pinned k6 binary into node_modules/.bin
provisionPool.ts          U1 — lease N pool slots + the admin slot → pool.json / tokens.json / admin.json
corpus/foodQueries.json   U3 — 113 varied, USDA-resolvable food queries
journey.js                 U4 — the k6 script (search → add → poll), staged profile, thresholds
config.example.env         tunables (target, pool size, stage rates/durations, SC-hold thresholds)
observe/collectMetrics.mjs  U2 — poll admin /metrics + /queue + CloudWatch over the window → series
run.mjs                      U5 — orchestrate lease → k6 → observe → report
```

## Observing the server side (U2)

`run.mjs` does this automatically; to run it standalone (in a second shell):

```bash
# The food:admin observer is the pool's admin slot (kept OUT of the VU pool), leased with it.
npm run provision:pool                         # writes admin.json; verifies /api/v1/foods/admin/queue -> 200

# Sample the service's own operational truth over the window (refreshes the ~60s admin token itself).
DURATION_S=180 INTERVAL_S=10 \
  FOOD_CLUSTER=<ecs-cluster-name> FOOD_SERVICE=<api-service-name> \
  npm run collect                              # writes server-metrics.json (queue + metrics + CloudWatch)
```

## Metrics

`journey.js` emits, beyond k6's built-ins: `food_search_latency` / `food_add_accept_latency` (recorded
**only for successful** 200/202 responses so failures can't deflate p95), `food_poll_to_terminal`,
`food_reached_terminal` (share of adds reaching a terminal state within the poll timeout — the
throttle-backlog signal), `food_terminal_status{status}` (RESOLVED/UNRESOLVED/NOT_FOUND/FAILED mix),
`food_auth_shed_503` (graceful backpressure), and the **rates** `food_unexpected_5xx` and
`food_auth_fail`. SC-hold is encoded as k6 `thresholds` (p95 latencies, `food_unexpected_5xx` rate,
`food_auth_fail` rate ~0, and a `dropped_iterations` cap so silent VU starvation fails the run).
