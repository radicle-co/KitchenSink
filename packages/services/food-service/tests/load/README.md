# food-service load / performance tests (k6)

These are **k6** scripts — the required performance gate for `@kitchensink/food-service` (per
`docs/CODING_STANDARDS.md §7.1`), the food mirror of `packages/services/recipe-service/tests/load`. They
are ES-module JavaScript run by the **k6 binary**, not by node or vitest, and are excluded from the vitest
suite by the `.load.js` suffix / this `tests/load/` directory (vitest's `include` matches only `*.test.ts`).

> A separate, richer food load harness — a distinct-user pool + server-side CloudWatch sampling against a
> deployed preview — lives in `packages/tools/loadtest` and is driven by `.github/workflows/food-loadtest.yml`.
> This directory is the lightweight, contract-scoped k6 suite mirroring the recipe pattern.

| Script                    | Requirement  | Assertion (via `options.thresholds`)                                             |
| ------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `service-erasure.load.js` | CR-002 / U4b | internal EdDSA-guarded erasure POST p95 ≤ 500ms (200) + expired → 401 under load |

A threshold breach makes `k6 run` exit non-zero, which fails the invoking CI job.

## Prerequisites

- The **k6 binary** — https://grafana.com/docs/k6/latest/set-up/install-k6/.
- A running food-service reachable at `FOOD_API_BASE_URL`, booted trusting the minted public key
  (`FOOD_SERVICE_PRINCIPAL_JWT_KEY`, see below).
- Node (to run the `prepare-erasure-tokens.ts` mint step via `tsx`).

## The internal erasure route needs EdDSA tokens minted OUTSIDE k6

`POST /v1/internal/account/erasure` is guarded by a single-target EdDSA service token pinning the **food**
audience (`FoodServiceErasureGuard`), NOT Clerk. k6's goja runtime cannot sign Ed25519, so — exactly as the
recipe suite's `prepare-db.mjs` / version-archive fixture seed state before a run — `prepare-erasure-tokens.ts`
mints the tokens first (with `jose`, against the shared `@kitchensink/recipe-core` wire contract) and the k6
script loads the pool via `open()`. The target requester is bound IN each token (there is no request body),
and every owner is a synthetic, non-existent ULID, so the erase deletes 0 `fetch_requesters` rows — a
harmless idempotent no-op that never touches real data.

## Configuration (environment variables)

| Variable                    | Default                          | Meaning                                            |
| --------------------------- | -------------------------------- | -------------------------------------------------- |
| `FOOD_API_BASE_URL`         | `http://localhost:3000`          | Base URL of the food-service under test            |
| `FOOD_LOAD_PEAK_VUS`        | `50`                             | Peak concurrent VUs                                |
| `FOOD_LOAD_RAMP_UP`         | `30s`                            | Ramp-up duration                                   |
| `FOOD_LOAD_HOLD`            | `1m`                             | Hold-at-peak duration                              |
| `FOOD_LOAD_RAMP_DOWN`       | `15s`                            | Ramp-down duration                                 |
| `FOOD_ERASURE_P95_MS`       | `500`                            | p95 budget (ms) for the internal erasure POST      |
| `FOOD_ERASURE_TOKENS_FILE`  | `tests/load/erasure-tokens.json` | pool file `service-erasure.load.js` opens          |
| `ERASURE_TOKEN_POOL_SIZE`   | `200`                            | distinct single-target tokens minted by prepare    |
| `ERASURE_TOKEN_TTL_SECONDS` | `120`                            | minted-token TTL (capped at the 120s contract max) |

## Running

Run from the `packages/services/food-service` directory (paths below are relative to it), or pass the full
path from the repo root.

```bash
export FOOD_API_BASE_URL=https://food.commise.app

# k6 cannot sign Ed25519 — mint the token pool + keypair FIRST. Owners are synthetic + non-existent, so the
# erase is a harmless no-op. Keep the total run inside the token TTL (120s; the default shape is ≈105s) or
# re-run this step. Boot food-service with the printed public key so it trusts the minted signer:
#   FOOD_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"
npx tsx tests/load/prepare-erasure-tokens.ts
k6 run tests/load/service-erasure.load.js

# Machine-readable summary
k6 run --summary-export=k6-erasure-summary.json tests/load/service-erasure.load.js
```

## CI / gating

Like the recipe suite's opt-in load scripts, this is run **on demand or against a deployed sandbox
instance**, never on ordinary PR/push pipelines. Wiring it into a booted-service CI job needs, before the
`k6 run` step: (1) `npx tsx tests/load/prepare-erasure-tokens.ts` to mint the keypair + pool, and (2) the
booted food-service given `FOOD_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)"`.
Unlike recipe, the food erase is a synchronous DELETE with no SQS hand-off, so no queue/LocalStack is
required — only a migrated Postgres for the food service to boot against.
