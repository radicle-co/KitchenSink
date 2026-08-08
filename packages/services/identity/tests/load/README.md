# identity-service load / performance tests (k6)

These are **k6** scripts — the required performance gate for `@kitchensink/identity-service` (per
`docs/CODING_STANDARDS.md §7.1`, which mandates unit **AND** integration **AND** e2e **AND** k6 for a
deployable HTTP service). They are a separate gate from the vitest pyramid: ES-module JavaScript run by
the **k6 binary**, not by node or vitest, and excluded from every vitest glob by the `.load.js` suffix.

Identity has the widest blast radius of any service here — it is the ONE identity provider every preview
and both stages sign in against (the shared persistent `identity.sandbox.commise.app`), so a latency or
throughput regression here degrades everything.

> **This tier replaces `tests/perf/latency-perf.test.ts` as the enforcement of identity's latency
> targets.** That file is a vitest test in the UNIT tier that asserts constants against themselves
> (`expect(targets.profileP99).toBe(1000)`) under no load, no concurrency and no service — it cannot fail
> for any reason related to performance. It should be deleted; the thresholds below are what actually
> hold the line.

## Scenarios

| Script                            | Endpoint(s)                                          | Asserts (via `options.thresholds`)                                                                                               |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `session-hot-path.load.js`        | `GET /api/v1/users/me` + `GET /health/ready`         | profile p95 ≤ 500ms **and p99 ≤ 1s** (NFR-011a); readiness stays 200 and p95 ≤ 1s _while the service is saturated_               |
| `auth-rejection.load.js`          | `GET /api/v1/users/me` with 5 bad credentials        | every invalid credential → `401` (SC-006), rejection p95 ≤ 250ms, and legitimate traffic keeps its 500ms budget during the storm |
| `admin-user-search.load.js`       | `GET /api/v1/admin/users` (`?email` `?name` `?sub`)  | `ilike` scan p95 ≤ 1s; primary-key probe p95 ≤ 500ms (the indexed contrast)                                                      |
| `provisioning-and-rename.load.js` | first request for an unseen `sub`; `PATCH /users/me` | first-sight provisioning p95 ≤ 1s; rename p95 ≤ 500ms                                                                            |

A threshold breach makes `k6 run` exit non-zero, which fails the invoking CI job.

### Why these endpoints

- **`GET /api/v1/users/me`** is the platform's hottest authenticated route, and more importantly it is
  where the tax **every** authenticated request pays is visible: `AuthMiddleware` verifies the Clerk token
  and then runs read-through `resolveOrCreateFromClaims` before any route body. The route itself then
  costs **four sequential DB round trips** (middleware join → `UserDAO.findById` →
  `AccountDAO.findByUserId` → profiles select).
- **`GET /health/ready`** is measured **only while the service is under load**, because that is the only
  time it means anything: it shares the same 20-connection `pg` pool as request traffic, so pool
  exhaustion makes the probe slow → time out (2s) → answer 503, at which point the ALB drains tasks that
  were merely busy. That cascade is identity's worst failure mode and an idle health check cannot see it.
- **The rejection path** matters for performance, not just security: identity sits on a public
  internet-facing ALB (ADR-0003) with no trusted-header shortcut (PR #39) and no rate limiter of its own,
  so anybody can make it verify unlimited invalid bearers. The scenario proves rejection is cheap, fails
  closed for five distinct reasons, and — critically — does not starve real users.
- **First-sight provisioning** is the only identity path whose cost is a multi-statement transaction
  (users + accounts + profiles), it runs _inside the auth middleware_ so a stall there locks the user out
  of every route, and it is the path with a recorded production incident (a webhook/read-through dedup
  race dropped a `user.created`).
- **The admin list** is the only identity query whose cost grows with the table: `ilike '%needle%'` cannot
  use a btree, so it sequentially scans. Everything else is a flat indexed lookup.

Deliberately **excluded**, with reasons: `DELETE /api/v1/users/me` (account closure — once per user
lifetime, destructive, and it tombstones the very principal presenting the token, so it cannot be
repeated per VU; correctness is covered by the integration/e2e tiers); avatar presign (once per avatar
change, and the object PUT goes to S3 directly, not through the service); admin
suspend/unsuspend/reactivate/impersonation (operator actions at human rates); webhook processing (the
plan's third target — it lives in `@kitchensink/identity-webhooks`, a Lambda, not this HTTP service).

## Thresholds and where the numbers come from

`lib/common.js` carries every budget with its derivation. Sources:

- **`specs/002-user-auth/plan.md` § "Performance Targets (NFR-011a)"** — silent token refresh ≤ 500ms
  P99; **profile data endpoint ≤ 1s P99**; webhook processing ≤ 2s P99.
- **`specs/002-user-auth/spec.md`** — SC-006 (100% of requests without a valid token receive 401),
  SC-007 (10,000 concurrent authenticated users, aligned to Commise SC-009).
- **The recipe/food k6 suites** — p95 ≤ 500ms for an indexed read or a single-row write (SC-009), < 2s
  for a full-text search. Used as the cross-service reference point.
- **`src/health/readiness.ts`** — `READINESS_PROBE_TIMEOUT_MS = 2000`, and the ECS/ALB health checks in
  `infra/lib/identity-service-stack.ts` (30s interval, 10s timeout). The readiness budget is set at HALF
  the probe timeout so it fails while the probe is merely at risk, not after the ALB starts cycling tasks.

Every budget is env-overridable, and `lib/common.js` states for each one a **concrete mechanism that can
breach it** — a budget nothing can cross is theatre.

## Auth — no live Clerk instance is ever contacted

Identity protects everything except `/health` and `/health/ready`, verifying Clerk session tokens
networklessly against a pinned PEM public key with `azp` enforcement. So:

1. `prepare-clerk-tokens.ts` generates a **throwaway RSA keypair**, mints the token pools locally, and
   writes the public half to `clerk-public-key.pem`.
2. The service under test is booted with `CLERK_JWT_KEY="$(cat clerk-public-key.pem)"` and
   `CLERK_AUTHORIZED_PARTIES=https://identity-load.test` — exact-match `azp` list mode, the production
   posture.
3. k6 loads the pools via `open()` and never touches crypto (its goja runtime cannot sign RS256).

This drives the **real** verifier, the **real** `azp` boundary and the **real** read-through provisioning
with **zero** requests to Clerk. That is load-bearing, not incidental: the shared sandbox Clerk dev
instance is a single per-IP rate limit, and minting a pool from one runner — let alone per iteration —
trips a multi-minute cool-down that turns CI red for reasons unrelated to identity's performance (see
`packages/tools/loadtest/README.md`, which documents exactly that throttle for the food journey). **Do
not** "improve" this by provisioning real Clerk users.

> ⚠️ `IDENTITY_DEV_AUTH_USER_ID` **must not be set** for these runs. That non-production dev bypass
> short-circuits `AuthMiddleware` entirely — no token verification and no read-through provisioning —
> i.e. it removes the two things this tier exists to measure. (The recipe load job legitimately uses its
> equivalent, because recipe's load is about recipe routes, not about auth.) `auth-rejection.load.js`
> detects the mistake for free: under the bypass its invalid credentials would answer `200` instead of
> `401` and the SC-006 check would collapse.

> 🔒 `clerk-tokens.json` and `clerk-public-key.pem` are **generated, gitignored credential material** —
> ~6,000 signed bearer tokens in a public repo. Never commit them, never `git add -f` them, and never
> echo token contents into CI logs. The prepare steps print counts and configuration only.

## Prerequisites

- The **k6 binary** — <https://grafana.com/docs/k6/latest/set-up/install-k6/>, or
  `npm run k6:install --workspace=packages/tools/loadtest` (downloads a pinned binary into
  `node_modules/.bin`).
- A Postgres reachable at `DATABASE_URL`, holding a **disposable** database (`prepare-db.ts` DROPs its
  `public` schema).
- A running identity-service reachable at `IDENTITY_API_BASE_URL`, booted with the generated public key.
  A **container** is the reliable way to boot it: `node dist/src/main.js` outside the image cannot resolve
  the workspace `@kitchensink/*` bare specifiers (the shared packages export `./src`, and the image COPYs
  their `prod.package.json` to repoint at `./dist`), and `tsx src/main.ts` fails Nest DI at runtime.

## Configuration

| Variable                                         | Default                      | Meaning                                                                            |
| ------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| `IDENTITY_API_BASE_URL`                          | `http://localhost:3001`      | Base URL of the service under test                                                 |
| `IDENTITY_LOAD_PEAK_VUS`                         | `50`                         | Peak concurrent VUs (see the SC-007 note below)                                    |
| `IDENTITY_LOAD_RAMP_UP` / `_HOLD` / `_RAMP_DOWN` | `30s` / `1m` / `15s`         | Load shape                                                                         |
| `IDENTITY_WARM_POOL_SIZE`                        | `50`                         | Pre-seeded warm principals (must be ≥ peak VUs)                                    |
| `IDENTITY_COLD_POOL_SIZE`                        | `6000`                       | Single-use provisioning tokens (see the exhaustion note)                           |
| `IDENTITY_BULK_USERS`                            | `20000`                      | Filler `users` rows that give the admin scan real cost                             |
| `IDENTITY_TOKEN_TTL_SECONDS`                     | `3600`                       | Minted-token lifetime                                                              |
| `IDENTITY_LOAD_AZP`                              | `https://identity-load.test` | The `azp` valid tokens claim (must match the service's `CLERK_AUTHORIZED_PARTIES`) |
| `IDENTITY_TOKENS_FILE`                           | `../clerk-tokens.json`       | Pool file the scripts `open()` — **script-relative**                               |
| `IDENTITY_ME_P95_MS` / `_P99_MS`                 | `500` / `1000`               | Profile-read budgets                                                               |
| `IDENTITY_PROVISION_P95_MS`                      | `1000`                       | First-sight provisioning budget                                                    |
| `IDENTITY_RENAME_P95_MS`                         | `500`                        | Rename budget                                                                      |
| `IDENTITY_ADMIN_SEARCH_P95_MS`                   | `1000`                       | `ilike` scan budget                                                                |
| `IDENTITY_ADMIN_LOOKUP_P95_MS`                   | `500`                        | Primary-key probe budget                                                           |
| `IDENTITY_READY_P95_MS`                          | `1000`                       | Readiness-under-load budget (half the 2s probe timeout)                            |
| `IDENTITY_REJECT_P95_MS`                         | `250`                        | `401` rejection budget                                                             |
| `IDENTITY_READY_RATE`                            | `2`                          | Readiness probes per second                                                        |

⚠️ **`open()` is resolved relative to the SCRIPT, not the process cwd.** `lib/common.js` therefore opens
`../clerk-tokens.json`, which is correct whether k6 is invoked from the package directory or the repo
root. Do not "fix" it to a cwd-relative path.

## Running

```bash
cd packages/services/identity

# 1. Mint the token pools + the public key the service must trust.
npm run test:load:tokens

# 2. Migrate + seed the disposable load database.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/identity_load npm run test:load:db

# 3. Boot the service against that DB with the generated key (container; see Prerequisites).
docker build -f Dockerfile -t identity-load:local ../../..   # after `npm run docker:prepare`
docker run -d --name identity-load --network host \
    -e NODE_ENV=development -e STAGE=loadtest -e PORT=3001 \
    -e DATABASE_URL=postgres://postgres:postgres@localhost:5432/identity_load \
    -e DELETION_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/000000000000/identity-load-deletion \
    -e CLERK_JWT_KEY="$(cat tests/load/clerk-public-key.pem)" \
    -e CLERK_AUTHORIZED_PARTIES=https://identity-load.test \
    identity-load:local

# 4. Run the suite (all four, in the order that matters — see below).
IDENTITY_API_BASE_URL=http://localhost:3001 npm run test:load

# …or one scenario, with a machine-readable summary for triage:
k6 run --summary-export=k6-hotpath-summary.json tests/load/session-hot-path.load.js
```

### ⚠️ Script ORDER is load-bearing — `provisioning-and-rename` runs LAST

`npm run test:load` runs `session-hot-path` → `auth-rejection` → `admin-user-search` →
`provisioning-and-rename`, and that order is deliberate on two counts:

1. **`provisioning-and-rename` is the only write-heavy script**, inserting thousands of users. Running it
   earlier leaves Postgres autovacuuming and checkpointing _during_ the read-sensitive scripts. Measured:
   with the rejection script running immediately after it, `validUnderStorm` p95 was **722ms** (breaching
   its 500ms budget) and rejection p95 **263ms**; on a settled database the same script measured **5.4ms**
   and **1.5ms**. That is a ~130× artefact of ordering — enough to produce a red run that looks like a
   service defect and is not one.
2. **Its cold tokens are single-use.** They are only "cold" against a database that has never seen their
   `sub`, so it must run before anything re-prepares the DB, and running it last means the single
   `prepare-db` at the start is sufficient for the whole suite.

If you run scripts individually and out of order, re-run `npm run test:load:db` (and restart the service,
so its pool does not hold connections to the dropped schema) first.

### Measurement-validity thresholds

Two thresholds guard the _honesty_ of the numbers rather than the service, and both fail the run:

- **`identity_cold_pool_exhausted`** — a cold token presented twice takes the cheap `existing` branch and
  would be reported as provisioning latency. This caught a genuine bug during development: the obvious
  `(__VU - 1) * stride + __ITER` claim is wrong because **`__VU` is the VU id across the whole test, not
  within its scenario**, so a two-scenario script hands the second scenario a block of high ids and every
  index overflowed. The scripts now index by `exec.scenario.iterationInTest`.
- **`identity_cold_already_existed`** — the same failure via a stale database: if a "cold" user was created
  before this run started, the sample is not provisioning. Checked against a `setup()` timestamp.

The same `__VU` trap is why `lib/common.js` rotates warm principals by `exec.scenario.iterationInTest`:
using `__VU` mapped two scenarios onto the same warm user, and two concurrent writers on one profile row
made `patchUserMe`'s non-transactional read-after-write return the other writer's value — a ~0.1% check
failure that looked like a service bug and was purely a harness defect.

## SC-007 at 10,000 concurrent

SC-007 targets 10,000 concurrent authenticated users. One k6 runner cannot honestly generate that, so the
peak is env-driven (`IDENTITY_LOAD_PEAK_VUS`): CI runs a safe smoke value and the full validation is a
distributed / k6 Cloud run supplying a high peak. **The thresholds are identical at every peak**, so the
pass/fail bar never changes with scale — only the sample count does.

The default 50 VUs with 1s think-time is ~40–55 req/s per operation, which sits between the plan's Day-30
capacity point (500 DAU, peak 50 req/s) and Day-90 (1,500 DAU, peak 200 req/s) — i.e. the smoke shape
already exceeds today's sizing, against ONE task (the deployed service scales 1→6 at 60% CPU).

## Baseline (measured, local — NOT the deployed numbers)

Recorded on one full ordered suite run: 50 peak VUs, 20,051 users, k6 v0.54.0, the service in its
production Docker image against a local Docker Postgres 16, all on one developer workstation. **These are
not deployed numbers** — a `512`-CPU-unit Fargate task talking to RDS over the network with TLS will be
materially slower, so treat the deployed p95s as unvalidated until the CI job (or a sandbox run) reports
them. 31,178 checks passed, 0 failures, 0 dropped iterations, both validity counters 0.

| Operation                     | med    | p95     | p99     | Budget       |
| ----------------------------- | ------ | ------- | ------- | ------------ |
| `getUserMe`                   | 4.32ms | 5.49ms  | 6.23ms  | 500 / 1000ms |
| `readiness` (under load)      | 1.62ms | 2.41ms  | 4.94ms  | 1000ms       |
| `rejected` (401)              | 0.96ms | 1.49ms  | 1.74ms  | 250ms        |
| `validUnderStorm`             | 4.34ms | 5.36ms  | 6.13ms  | 500ms        |
| `adminLookupById` (PK probe)  | 3.39ms | 4.13ms  | 5.10ms  | 500ms        |
| `adminSearchMiss` (full scan) | 8.43ms | 9.47ms  | 12.19ms | 1000ms       |
| `adminSearchHit` (full scan)  | 7.30ms | 8.30ms  | 10.91ms | 1000ms       |
| `adminSearchName` (full scan) | 7.12ms | 8.29ms  | 10.09ms | 1000ms       |
| `patchUserMe`                 | 5.36ms | 8.95ms  | 19.79ms | 500ms        |
| `provisionOnFirstRequest`     | 6.02ms | 10.99ms | 23.38ms | 1000ms       |

Run-to-run variance on a shared workstation is significant (`getUserMe` p95 ranged 5.5–21ms across runs),
which is the reason the budgets are regression bars with headroom rather than tight fits.

**Capacity note.** The admin `ilike` scan costs ≈ 9.5ms p95 at 20,051 rows. Extrapolated linearly that
budget is breached near ~2M users — and linear is the optimistic case, since wider rows and TOAST make
real scans worse. The fix, when it is needed, is a trigram (`pg_trgm` GIN) index or a full-text column,
not a bigger budget; `adminLookupById` is in the same script precisely so the indexed-vs-scan gap stays
visible while it is still cheap.

## CI

The k6 tier belongs in `_ci-heavy.yml`, gated behind the same `run_load_test` input as the recipe and
food load jobs, so it never fires on ordinary PR pipelines. Because `clerk-tokens.json` is gitignored, the
job **must mint the pool itself** (`npm run test:load:tokens`) — it can never assume the file exists, and
must never fall back to skipping quietly. The exact job is specified in the accompanying task report; it
mirrors the `load-test` job's shape (Postgres service container, Docker image boot, `--summary-export`
artifacts, container logs on failure) and needs **no LocalStack**, since none of these four scenarios
touches S3 or SQS.
