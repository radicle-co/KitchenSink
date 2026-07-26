# recipe-service load / performance tests (k6)

These are **k6** scripts — the required performance gate for `@kitchensink/recipe-service` (per
`docs/CODING_STANDARDS.md §7.1`). They are a separate gate from the vitest unit/integration/e2e
pyramid: they are ES-module JavaScript run by the **k6 binary**, not by node or vitest, and they are
excluded from the vitest suite by the `.load.js` suffix / this `tests/load/` directory.

They target the performance requirements of Feature 001:

| Script                         | Requirement     | Assertion (via `options.thresholds`)                                             |
| ------------------------------ | --------------- | -------------------------------------------------------------------------------- |
| `sc009-read-write.load.js`     | SC-009          | `http_req_duration` p95 ≤ 500ms on recipe list / get / create                    |
| `search-latency.load.js`       | SC-009          | search `http_req_duration` p95 < 2s                                              |
| `save-under-archive.load.js`   | FR-007b-i       | recipe-save (create + update) p95 ≤ 500ms while the S3 archive is queued         |
| `pull-from-source.load.js`     | W8-a.8 / FR-011 | collection pull `previewPull` / `commitPull` p95 ≤ 500ms (read + write)          |
| `version-archive-read.load.js` | W8-a.7          | version GET served via the S3 archive fallback p95 < 1s                          |
| `service-erasure.load.js`      | CR-002 / U4a    | internal EdDSA-guarded erasure POST p95 ≤ 500ms (202) + expired → 401 under load |

A threshold breach makes `k6 run` exit non-zero, which fails the invoking CI job.

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

| Variable                             | Default                          | Meaning                                                  |
| ------------------------------------ | -------------------------------- | -------------------------------------------------------- |
| `RECIPE_API_BASE_URL`                | `http://localhost:3000`          | Base URL of the service under test                       |
| `RECIPE_LOAD_TEST_TOKEN`             | _(empty)_                        | Bearer session token                                     |
| `RECIPE_LOAD_PEAK_VUS`               | `50`                             | Peak concurrent VUs (see the SC-009 note below)          |
| `RECIPE_LOAD_RAMP_UP`                | `30s`                            | Ramp-up duration                                         |
| `RECIPE_LOAD_HOLD`                   | `1m`                             | Hold-at-peak duration                                    |
| `RECIPE_LOAD_RAMP_DOWN`              | `15s`                            | Ramp-down duration                                       |
| `RECIPE_SAVE_P95_MS`                 | `500`                            | p95 budget (ms) for read/write/save                      |
| `RECIPE_SEARCH_P95_MS`               | `2000`                           | p95 budget (ms) for search                               |
| `RECIPE_VERSION_ARCHIVE_READ_P95_MS` | `1000`                           | p95 budget (ms) for the S3 version-archive fallback read |
| `RECIPE_ARCHIVE_FIXTURE_RECIPE_ID`   | _(fixed id, see below)_          | recipe id `version-archive-read.load.js` reads           |
| `RECIPE_ERASURE_P95_MS`              | `500`                            | p95 budget (ms) for the internal erasure POST            |
| `RECIPE_ERASURE_TOKENS_FILE`         | `tests/load/erasure-tokens.json` | pool file `service-erasure.load.js` opens                |
| `ERASURE_TOKEN_POOL_SIZE`            | `200`                            | distinct single-target tokens minted by the prepare step |
| `ERASURE_TOKEN_TTL_SECONDS`          | `120`                            | minted-token TTL (capped at the 120s contract max)       |

## Running

```bash
export RECIPE_API_BASE_URL=https://recipe.commise.app
export RECIPE_LOAD_TEST_TOKEN='<clerk session token>'

# Individual scenarios
k6 run tests/load/sc009-read-write.load.js
k6 run tests/load/search-latency.load.js
k6 run tests/load/save-under-archive.load.js
k6 run tests/load/pull-from-source.load.js

# version-archive-read.load.js needs its fixture seeded FIRST (direct Postgres + S3 access k6 itself
# cannot do — see the script's own docstring). Idempotent; safe to re-run.
DATABASE_URL=postgres://... S3_ENDPOINT=... S3_BUCKET_VERSIONS=commise-versions \
    npx tsx tests/load/prepare-version-archive-fixture.ts
k6 run tests/load/version-archive-read.load.js

# service-erasure.load.js hits the internal EdDSA-guarded route (CR-002 / U4a). k6 cannot sign Ed25519, so
# the tokens are minted FIRST (fresh throwaway keypair + a pool of distinct single-target tokens) and the
# service under test must be booted trusting the printed public key. Owners are synthetic + non-existent, so
# the erase is a harmless idempotent no-op — no real data is touched. Keep the total run inside the token
# TTL (120s; the default shape is ≈105s) or re-run the prepare step.
npx tsx tests/load/prepare-erasure-tokens.ts
#   boot recipe-service with:  RECIPE_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"
k6 run tests/load/service-erasure.load.js

# Machine-readable summary (used by the CI job's artifact upload)
k6 run --summary-export=k6-summary.json tests/load/sc009-read-write.load.js
```

Run from the `packages/services/recipe-service` directory (paths above are relative to it), or pass
the full path from the repo root.

## SC-009 at 10k concurrent

SC-009's headline is _p95 ≤ 500ms at 10k concurrent_. A single k6 runner cannot honestly generate
10k VUs, so the peak is env-driven (`RECIPE_LOAD_PEAK_VUS`) — CI runs a safe smoke value, and the
full 10k validation is a distributed / **k6 Cloud** run supplying a high `RECIPE_LOAD_PEAK_VUS`. The
thresholds are identical regardless of the peak, so the pass/fail bar does not change with scale.

## CI

The `load-test` job in `.github/workflows/_ci.yml` installs k6 and runs `sc009-read-write.load.js`,
`search-latency.load.js`, and `save-under-archive.load.js` against a booted service. It is gated (off by
default via the `run_load_test` workflow input) so the heavy load run never fires on ordinary PR / push
pipelines — a caller opts in by passing `run_load_test: true`.

`pull-from-source.load.js` and `version-archive-read.load.js` are NOT yet wired into that job (a
follow-up — `version-archive-read.load.js` additionally needs the `prepare-version-archive-fixture.ts`
step added before the `k6 run` step, mirroring the existing `prepare-db.mjs` step).

`service-erasure.load.js` is likewise NOT yet wired into that job (a follow-up, the same status as the
two scripts above). Wiring it needs, before the `k6 run` step: (1) an `npx tsx tests/load/prepare-erasure-tokens.ts`
step to mint the keypair + token pool, (2) the booted service given
`RECIPE_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"` so it trusts the minted
signer, and (3) a reachable SQS (the accept path enqueues a delete-everything message — the current
`load-test` job has no LocalStack, so add one + create the `ACCOUNT_ERASURE_QUEUE_URL` queue, or run the
script against a deployed sandbox instance whose queue already exists). Until then it runs on demand /
against a deployed instance, gated exactly like the rest of this suite.
