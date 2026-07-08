# recipe-service load / performance tests (k6)

These are **k6** scripts — the required performance gate for `@kitchensink/recipe-service` (per
`docs/CODING_STANDARDS.md §7.1`). They are a separate gate from the vitest unit/integration/e2e
pyramid: they are ES-module JavaScript run by the **k6 binary**, not by node or vitest, and they are
excluded from the vitest suite by the `.load.js` suffix / this `tests/load/` directory.

They target the performance requirements of Feature 001:

| Script                       | Requirement | Assertion (via `options.thresholds`)                                     |
| ---------------------------- | ----------- | ------------------------------------------------------------------------ |
| `sc009-read-write.load.js`   | SC-009      | `http_req_duration` p95 ≤ 500ms on recipe list / get / create            |
| `search-latency.load.js`     | SC-009      | search `http_req_duration` p95 < 2s                                      |
| `save-under-archive.load.js` | FR-007b-i   | recipe-save (create + update) p95 ≤ 500ms while the S3 archive is queued |

A threshold breach makes `k6 run` exit non-zero, which fails the invoking CI job.

## Prerequisites

- The **k6 binary** — https://grafana.com/docs/k6/latest/set-up/install-k6/ (e.g. `brew install k6`,
  or the Debian/Ubuntu apt package used by the `load-test` CI job).
- A running recipe-service reachable at `RECIPE_API_BASE_URL`.
- A valid Clerk **session token** in `RECIPE_LOAD_TEST_TOKEN`. Every route except `/health` is
  auth-protected, so without a token the service returns `401` and the failure-rate threshold trips.

## Configuration (environment variables)

| Variable                 | Default                 | Meaning                                         |
| ------------------------ | ----------------------- | ----------------------------------------------- |
| `RECIPE_API_BASE_URL`    | `http://localhost:3000` | Base URL of the service under test              |
| `RECIPE_LOAD_TEST_TOKEN` | _(empty)_               | Bearer session token                            |
| `RECIPE_LOAD_PEAK_VUS`   | `50`                    | Peak concurrent VUs (see the SC-009 note below) |
| `RECIPE_LOAD_RAMP_UP`    | `30s`                   | Ramp-up duration                                |
| `RECIPE_LOAD_HOLD`       | `1m`                    | Hold-at-peak duration                           |
| `RECIPE_LOAD_RAMP_DOWN`  | `15s`                   | Ramp-down duration                              |
| `RECIPE_SAVE_P95_MS`     | `500`                   | p95 budget (ms) for read/write/save             |
| `RECIPE_SEARCH_P95_MS`   | `2000`                  | p95 budget (ms) for search                      |

## Running

```bash
export RECIPE_API_BASE_URL=https://recipe.commise.app
export RECIPE_LOAD_TEST_TOKEN='<clerk session token>'

# Individual scenarios
k6 run tests/load/sc009-read-write.load.js
k6 run tests/load/search-latency.load.js
k6 run tests/load/save-under-archive.load.js

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

The `load-test` job in `.github/workflows/_ci.yml` installs k6 and runs these scripts against a booted
service. It is gated (off by default via the `run_load_test` workflow input) so the heavy load run
never fires on ordinary PR / push pipelines — a caller opts in by passing `run_load_test: true`.
