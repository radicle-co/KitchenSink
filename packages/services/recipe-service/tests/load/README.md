# recipe-service load / performance tests (k6)

> ## ⛔ CI NO LONGER RUNS THESE (owner ruling, 2026-09-05)
>
> Verbatim: _"K6 should also be hitting sandbox or production, depending on the flow, as I already stated
> earlier. It follows the same pattern as the end to end tests"_ — i.e. k6 measures a DEPLOYED environment
> and SKIPS when this PR's sandbox is not running.
>
> The job that ran the scripts below (`load-test` in `.github/workflows/_ci-heavy.yml`) booted its own
> substrate on the runner, and every assertion here IS that substrate — a seeded corpus in a runner-local Postgres, an SQS queue nothing drains so its DEPTH is the fan-out evidence, a LocalStack S3 snapshot, a throwaway EdDSA keypair the deployed service does not trust, a local food stub whose chunk counters are the proof, and an UNREACHABLE food origin whose unreachability is the assertion. A deployed origin cannot
> present any of it, so the job was DELETED rather than re-pointed, along with the container, the
> migrations, the seeding and the fixtures it needed.
>
> **What CI runs instead:** one job, `load-test-deployed`, running
> `packages/tools/loadtest/deployedOrigin.load.js` against this stage's deployed recipe, food and identity
> origins. It gates on the two facts a slow, shared machine cannot cause — no 5xx, and a protected route
> never answering 2xx unauthenticated — and REPORTS latency without a threshold, because every budget in
> the table below was calibrated on a dedicated runner container and would redden on a neighbour's traffic
> on a 0.5-vCPU `FARGATE_SPOT` preview sharing a `db.t4g.micro`.
>
> **These scripts are still committed, still correct, and still runnable by hand** — see the run
> instructions below. What is gone is the automatic gate: nothing now fails a PR when one of the budgets
> in this table regresses. That is a real, accepted loss of coverage, not an oversight.

These are **k6** scripts — the required performance gate for `@kitchensink/recipe-service` (per
`docs/CODING_STANDARDS.md §7.1`). They are a separate gate from the vitest unit/integration/e2e
pyramid: they are ES-module JavaScript run by the **k6 binary**, not by node or vitest, and they are
excluded from the vitest suite by the `.load.js` suffix / this `tests/load/` directory.

They target the performance requirements of Feature 001:

| Script                             | Requirement           | Assertion (via `options.thresholds`)                                                                                            |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sc009ReadWrite.load.js`           | SC-009                | `http_req_duration` p95 ≤ 500ms on recipe list / get / create                                                                   |
| `searchLatency.load.js`            | SC-009                | search `http_req_duration` p95 < 2s                                                                                             |
| `ingredientSuggestLatency.load.js` | search Stage 2 / F2   | blended ingredient typeahead p95 < 1.5s AND a degrading food catalog never produces a non-2xx                                   |
| `saveUnderArchive.load.js`         | FR-007b-i             | recipe-save (create + update) p95 ≤ 500ms while the S3 archive is queued                                                        |
| `pullFromSource.load.js`           | W8-a.8 / FR-011       | collection pull `previewPull` / `commitPull` p95 ≤ 500ms (read + write)                                                         |
| `versionArchiveRead.load.js`       | W8-a.7                | version GET served via the S3 archive fallback p95 < 1s                                                                         |
| `serviceErasure.load.js`           | CR-002 / U4a          | internal EdDSA-guarded erasure POST p95 ≤ 500ms (202) + expired → 401 under load                                                |
| `nutritionBatch.load.js`           | REQ-IF-008 / ADR-0021 | deferred nutrition batch p95 ≤ 1.5s at BOTH ends of the ingredient-overlap spectrum, + a food outage degrades rather than fails |

A threshold breach makes `k6 run` exit non-zero, which fails the invoking CI job.

## ⛔ `nutritionBatch.load.js` measures a FAN-OUT, and needs three things the others do not

Its subject is not "is a batch read fast" but `ceil(distinctFoods / 100) / 6` waves of calls to the food
service (ADR-0021 §4). Three conditions have to hold or it silently measures something else — which is
exactly what its predecessor did, padding to the 500-id cap with ids that resolve to no recipe and reporting
a one-call fan-out as if it were the cap:

1. **A seeded fixture with DISJOINT ingredient sets.** `npx tsx tests/load/prepareNutritionFanoutFixture.ts`
   seeds two 500-recipe sets that differ only in ingredient overlap (5,000 distinct foods vs 12) and emits
   the ids plus their MEASURED distinct-food counts to `tests/load/perf-fixture.json` (generated,
   gitignored). Without it the script fails at init rather than running on ids that resolve to nothing.
2. **A forwarded bearer.** `FoodNutritionGateway` degrades WITHOUT issuing a request when it has no caller
   credential, so a run with no `Authorization` header measures the short-circuit no matter how the fixture
   is shaped. Supply `RECIPE_LOAD_TEST_TOKEN` against a real stage; under the dev-auth bypass any string
   works (`RECIPE_LOAD_STUB_BEARER`).
3. **A food origin that answers, with latency.** Against an unreachable origin every wave is refused in
   microseconds and the fan-out is free. `tests/load/foodNutritionStub.mjs` answers food's published shape
   after `FOOD_STUB_DELAY_MS`, enforces the real 100-id cap with a `400`, and counts what it served at
   `GET /__stats` — the evidence that the fan-out happened, in chunk counts rather than inference.

⚠️ The p95 it reports is therefore **recipe's own cost + waves × the stub delay you chose**, not a
production figure. Sweep the delay rather than trusting one value: the slope is the fan-out cost. Measured
2026-08-17 — 9.04 ms per ms of food latency at the cap, against 9 predicted waves. The full history and the
budget's derivation live on `NUTRITION_BATCH_P95_MS` in `lib/common.js`.

## Prerequisites

- The **k6 binary** — https://grafana.com/docs/k6/latest/set-up/install-k6/ (e.g. `brew install k6`,
  or the Debian/Ubuntu apt package used by the `load-test` CI job).
- A running recipe-service reachable at `RECIPE_API_BASE_URL`.
- A valid Clerk **session token** in `RECIPE_LOAD_TEST_TOKEN`. Every route except `/health` is
  auth-protected, so without a token the service returns `401` and the failure-rate threshold trips.

## ⚠️ Rate limiting will trip these tests unless the target stage raises the limits

The service rate-limits by **client IP** (`ThrottlerGuard`'s default tracker). A single k6 runner drives
every VU from **one IP**, so the whole run shares one throttle counter per route — even the generous read
limit (`RATE_LIMIT_READ`, default 120/min) is exhausted almost immediately at any real VU count, and the
run collapses into `429`s (tripping `http_req_failed`). This is invisible if throttling is effectively
disabled on the target: a green SC-009 that was run against a stage where the `RATE_LIMIT_*` values were
cranked (or where the run stayed under the cap) does **not** prove the production limits behave.

To exercise these scripts against a realistic service you MUST run the target stage with generous
`RATE_LIMIT_*` overrides sized for `peak_vus × requests_per_vu_per_minute` (throttling is per-IP, so the
whole run counts as one client), e.g. `RATE_LIMIT_READ=1000000 RATE_LIMIT_WRITE=1000000 …`. The limits
never fall back to disabled (`throttleLimitFromEnv` rejects non-positive values), so pick a high positive
number. The load thresholds still measure latency/error-rate; they just stop being masked by the limiter.
(A truthful, throttling-on load test would need per-user tracking plus many distinct tokens — see the
per-user-tracking follow-up in the service's throttle notes.)

## Configuration (environment variables)

| Variable                                | Default                          | Meaning                                                  |
| --------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| `RECIPE_API_BASE_URL`                   | `http://localhost:3000`          | Base URL of the service under test                       |
| `RECIPE_LOAD_TEST_TOKEN`                | _(empty)_                        | Bearer session token                                     |
| `RECIPE_LOAD_PEAK_VUS`                  | `50`                             | Peak concurrent VUs (see the SC-009 note below)          |
| `RECIPE_LOAD_RAMP_UP`                   | `30s`                            | Ramp-up duration                                         |
| `RECIPE_LOAD_HOLD`                      | `1m`                             | Hold-at-peak duration                                    |
| `RECIPE_LOAD_RAMP_DOWN`                 | `15s`                            | Ramp-down duration                                       |
| `RECIPE_SAVE_P95_MS`                    | `500`                            | p95 budget (ms) for read/write/save                      |
| `RECIPE_SEARCH_P95_MS`                  | `2000`                           | p95 budget (ms) for search                               |
| `RECIPE_VERSION_ARCHIVE_READ_P95_MS`    | `1000`                           | p95 budget (ms) for the S3 version-archive fallback read |
| `RECIPE_SUGGEST_P95_MS`                 | `1500`                           | p95 budget (ms) for the blended ingredient typeahead     |
| `RECIPE_ARCHIVE_FIXTURE_RECIPE_ID`      | _(fixed id, see below)_          | recipe id `versionArchiveRead.load.js` reads             |
| `RECIPE_ERASURE_P95_MS`                 | `500`                            | p95 budget (ms) for the internal erasure POST            |
| `RECIPE_ERASURE_TOKENS_FILE`            | `tests/load/erasure-tokens.json` | pool file `serviceErasure.load.js` opens                 |
| `ERASURE_TOKEN_POOL_SIZE`               | `200`                            | distinct single-target tokens minted by the prepare step |
| `ERASURE_TOKEN_TTL_SECONDS`             | `120`                            | minted-token TTL (capped at the 120s contract max)       |
| `RECIPE_NUTRITION_BATCH_P95_MS`         | `1500`                           | p95 budget (ms) for the deferred nutrition batch         |
| `RECIPE_MAX_NUTRITION_IDS`              | `500`                            | the published recipe-id cap the scenario asserts         |
| `RECIPE_NUTRITION_FIXTURE_FILE`         | `./perf-fixture.json`            | fixture the nutrition scenario `open()`s                 |
| `RECIPE_LOAD_STUB_BEARER`               | _(a placeholder)_                | bearer forwarded when `RECIPE_LOAD_TEST_TOKEN` is unset  |
| `RECIPE_PERF_ALLOW_NONSTANDARD_DB`      | _(unset)_                        | seed into a disposable DB whose name is not on the list  |
| `FOOD_STUB_PORT` / `FOOD_STUB_DELAY_MS` | `3002` / `25`                    | the food stub's port and per-chunk latency               |

## Running

```bash
export RECIPE_API_BASE_URL=https://recipe.commise.app
export RECIPE_LOAD_TEST_TOKEN='<clerk session token>'

# Individual scenarios
k6 run tests/load/sc009ReadWrite.load.js
k6 run tests/load/searchLatency.load.js
k6 run tests/load/ingredientSuggestLatency.load.js
k6 run tests/load/saveUnderArchive.load.js
k6 run tests/load/pullFromSource.load.js

# versionArchiveRead.load.js needs its fixture seeded FIRST (direct Postgres + S3 access k6 itself
# cannot do — see the script's own docstring). Idempotent; safe to re-run.
DATABASE_URL=postgres://... S3_ENDPOINT=... S3_BUCKET_VERSIONS=commise-versions \
    npx tsx tests/load/prepareVersionArchiveFixture.ts
k6 run tests/load/versionArchiveRead.load.js

# serviceErasure.load.js hits the internal EdDSA-guarded route (CR-002 / U4a). k6 cannot sign Ed25519, so
# the tokens are minted FIRST (fresh throwaway keypair + a pool of distinct single-target tokens) and the
# service under test must be booted trusting the printed public key. Owners are synthetic + non-existent, so
# the erase is a harmless idempotent no-op — no real data is touched. Keep the total run inside the token
# TTL (120s; the default shape is ≈105s) or re-run the prepare step.
npx tsx tests/load/prepareErasureTokens.ts
#   boot recipe-service with:  RECIPE_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"
k6 run tests/load/serviceErasure.load.js

# nutritionBatch.load.js needs its fixture seeded AND a food origin that answers (see the fan-out note
# above). Against a service booted with the dev-auth bypass and FOOD_SERVICE_URL=http://localhost:3002:
DATABASE_URL=postgres://.../recipe_load npx tsx tests/load/prepareNutritionFanoutFixture.ts
FOOD_STUB_DELAY_MS=25 node tests/load/foodNutritionStub.mjs &
k6 run tests/load/nutritionBatch.load.js
curl -s localhost:3002/__stats   # 50 chunk requests of 100 ids per cap-fanout iteration, or it measured nothing

# Machine-readable summary (used by the CI job's artifact upload)
k6 run --summary-export=k6-summary.json tests/load/sc009ReadWrite.load.js
```

Run from the `packages/services/recipe-service` directory (paths above are relative to it), or pass
the full path from the repo root.

## SC-009 at 10k concurrent

SC-009's headline is _p95 ≤ 500ms at 10k concurrent_. A single k6 runner cannot honestly generate
10k VUs, so the peak is env-driven (`RECIPE_LOAD_PEAK_VUS`) — CI runs a safe smoke value, and the
full 10k validation is a distributed / **k6 Cloud** run supplying a high `RECIPE_LOAD_PEAK_VUS`. The
thresholds are identical regardless of the peak, so the pass/fail bar does not change with scale.

## CI (DELETED)

> ⛔ **HISTORICAL — this job was DELETED on 2026-09-05** (owner ruling; see the banner at the top of
> this file). The description below is kept as the record of what it did, so a future decision to
> restore it as a manual-dispatch tier does not have to be reconstructed from a diff.

The (now deleted) `load-test` job in `.github/workflows/_ci-heavy.yml` installs k6 and runs the scripts against a booted
service. It is gated (off by default via the `run_load_test` workflow input) so the heavy load run never
fires on ordinary PR / push pipelines — a caller opts in by passing `run_load_test: true`.

`nutritionBatch.load.js` has its OWN step there, after the others: it needs the fan-out fixture seeded and
the food stub listening, and both are deliberately bracketed around that single step so every other
script still sees the unreachable food origin they are written against. The step ends by asserting the
stub's counters — a run that served no chunked requests measured nothing, and no latency threshold can
tell you that.

`pullFromSource.load.js` and `versionArchiveRead.load.js` are NOT yet wired into that job (a
follow-up — `versionArchiveRead.load.js` additionally needs the `prepareVersionArchiveFixture.ts`
step added before the `k6 run` step, mirroring the existing `prepare-db.mjs` step).

`serviceErasure.load.js` is likewise NOT yet wired into that job (a follow-up, the same status as the
two scripts above). Wiring it needs, before the `k6 run` step: (1) an `npx tsx tests/load/prepareErasureTokens.ts`
step to mint the keypair + token pool, (2) the booted service given
`RECIPE_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"` so it trusts the minted
signer, and (3) a reachable SQS (the accept path enqueues a delete-everything message — the current
`load-test` job has no LocalStack, so add one + create the `ACCOUNT_ERASURE_QUEUE_URL` queue, or run the
script against a deployed sandbox instance whose queue already exists). Until then it runs on demand /
against a deployed instance, gated exactly like the rest of this suite.
