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

This is the `@kitchensink/loadtest` workspace (`packages/tools/loadtest`); commands run from here.

## Prerequisites

- Node 24 + repo deps installed (`npm ci` at the repo root).
- `k6` — installed into this package via `npm run k6:install` (downloads the pinned binary into
  `node_modules/.bin`, so the npm scripts below find it). No global install needed.
- AWS credentials for the sandbox account (to read the Clerk backend secret + CloudWatch for U2).
- A deployed, healthy food preview (e.g. `food-pr-59.commise.app`) — `GET /health` → 200.

## Run

```bash
cd packages/tools/loadtest
npm run k6:install                       # one-time: fetch the k6 binary
cp config.example.env config.env         # then edit knobs (target host, pool size, stage rates/thresholds)

# Clerk backend secret (mints the distinct-user token pool):
export CLERK_SECRET_KEY=$(aws secretsmanager get-secret-value \
  --secret-id kitchensink/sandbox/identity/keys --query SecretString --output text \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['SECRET_KEY'])")

# One command — provision → grant observer → k6 + server-side collection → correlated report.md →
# teardown of every test user (in a finally, so an interrupt never leaks users):
POOL_SIZE=100 FOOD_BASE_URL=https://food-pr-59.commise.app npm run loadtest
```

Or the steps individually: `npm run provision`, `npm run grant-admin`, `npm run journey`, `npm run collect`
(`POOL_SIZE` must be `>= MAX_VUS` — `journey.js` fails fast otherwise, since VU `i` authenticates as user `i`).

### Persistent pool (recommended locally — avoids Clerk's rate limit)

`npm run provision` mints users via Clerk's **Frontend API** (dev_browser → sign_ins), which is **per-IP
rate-limited** — minting a pool from one machine trips a multi-minute cool-down. Instead, provision a
**persistent** pool via the **Backend API** (no FAPI, no throttle) once and reuse it:

```bash
npm run provision:pool     # create-or-reuse test-{name}@radcile.com + admin (Backend API); writes pool.json
REUSE_POOL=1 ... npm run loadtest:reuse   # skips provisioning AND teardown; k6 refreshes tokens via Backend API
npm run sweep              # delete ALL test users (test-…/loadtest+…) — incl. crash-orphaned ones
```

The persistent users have stable emails and are **never torn down** by a run (only `sweep` deletes them),
so the pool survives across runs. Backend-minted tokens carry no `azp`, which the food guard accepts.

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
`food-service/tests/food-consumer.integration.test.ts` (`stall→resume`) — the load test demonstrates it end-to-end.

> **Promotion-by-request-count** (#2) and **flooding-user demotion/flood-shed** (#3) are queue-ordering
> invariants that only manifest under a backlog / near the depth ceiling — proven deterministically by
> `fetch-queue.dao`, `fairness-demotion`, and `admission` integration tests, not the k6 load test.

### Does the food really land in the DB?

Yes — with `VERIFY_PERSISTENCE=1` (default), when a food reaches a terminal state the journey reads the
USDA data **back from the DB** (the candidate set for `UNRESOLVED`, the golden record for `RESOLVED`) and
records `food_data_persisted`; a threshold (`rate>0.99`) **fails the run** if the sync→DB write is broken.

## Run in CI (GitHub Action)

Prefer not to run it locally? Trigger the **`Food API load test`** workflow
(`.github/workflows/food-loadtest.yml`): **Actions → Food API load test → Run workflow**, or:

```bash
gh workflow run food-loadtest.yml \
  -f target_url=https://food-pr-59.commise.app \
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
package.json                 @kitchensink/loadtest — npm scripts (k6:install, loadtest, provision, …)
install-k6.mjs               downloads the pinned k6 binary into node_modules/.bin
auth/provision-users.mjs   U1 — mint N Clerk users + session tokens → pool.json / tokens.json
corpus/food-queries.json   U3 — 113 varied, USDA-resolvable food queries
journey.js                 U4 — the k6 script (search → add → poll), staged profile, thresholds
config.example.env         tunables (target, pool size, stage rates/durations, SC-hold thresholds)
auth/grant-admin.mjs         U2 — grant food:admin to one observer user → admin.json
observe/collect-metrics.mjs  U2 — poll admin /metrics + /queue + CloudWatch over the window → series
run.mjs                      U5 — orchestrate setup → k6 → observe → report → teardown
```

## Observing the server side (U2)

`run.mjs` does this automatically; to run it standalone (in a second shell):

```bash
# One-time per run: a dedicated food:admin observer (kept OUT of the VU pool).
npm run grant-admin                            # writes admin.json; verifies /api/v1/foods/admin/queue -> 200

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
