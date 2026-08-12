# food-service load / performance tests (k6 + one SQL probe)

These are the **k6** scripts and the one Postgres probe that make up the required performance gate for
`@kitchensink/food-service` (per `docs/CODING_STANDARDS.md §7.1`, which mandates unit **AND** integration
**AND** e2e **AND** k6 for a deployable HTTP service). The k6 scripts are ES-module JavaScript run by the
**k6 binary**, not by node or vitest, and are excluded from every vitest glob by the `.load.js` suffix /
this `tests/load/` directory (vitest's `include` matches only `*.test.ts`).

> A separate, richer food load harness — a distinct-user pool + server-side CloudWatch sampling against a
> deployed preview — lives in `packages/tools/loadtest` and is driven by `.github/workflows/food-loadtest.yml`.
> This directory is the contract-scoped suite: one script per success criterion, every threshold traceable
> to a numbered line in `specs/003-usda-food-data/spec.md`.

## Scripts

| Script                           | Requirement     | Asserts (via `options.thresholds`)                                                                       |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `local-store-read.load.js`       | SC-001 + SC-004 | `GET /foods/{id}` for a `RESOLVED` food p95 ≤ 50ms; local-store serve rate > 80% over a mixed id set     |
| `local-store-throughput.load.js` | SC-005          | sustained served reads/sec > the SC-005 bar **and** > 85% of the offered arrival rate, p95 still ≤ 50ms  |
| `search.load.js`                 | SC-007          | `GET /foods/search` p95 ≤ 200ms at 50,000 foods, gated **per query shape** (7 shapes)                    |
| `drain-demotion.perf.ts`         | SC-003 + DSN-11 | `FetchQueueDao.leaseNext()` claim p95 ≤ 60ms +15% = **69ms** at depth 100 / 1,000 / 10,000, two profiles |
| `service-erasure.load.js`        | CR-002 / U4b    | internal EdDSA-guarded erasure POST p95 ≤ 500ms (200) + expired → 401 under load                         |

A threshold breach makes `k6 run` (or the probe) exit non-zero, which fails the invoking CI job. There is
no `|| true`, no `continue-on-error` and no skip-on-missing-fixture anywhere in this tier: every prepare
step's absence is a hard, actionable failure.

## Thresholds — where every number comes from, and what can breach it

`lib/common.js` carries each budget next to its derivation and, crucially, next to a **concrete mechanism
that can cross it** — a budget nothing can breach is theatre. Summarised:

| Budget                                                                                                  | Source                                                                                                                                                                                                                                                                                 | Mechanism that breaches it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **read p95 ≤ 50ms** (`READ_P95_MS`)                                                                     | **SC-001** verbatim: "Food reads for locally-`RESOLVED` items MUST return within 50ms at p95 latency."                                                                                                                                                                                 | The route is a signature verification plus **five** DB queries: `FoodDao.readGoldenRecord` reads `food`, then fans out over `food_sources`, `food_nutrients ⋈ nutrient`, `food_portions`, `food_field_provenance`. Pool saturation (`max: 20`), a lost `food_nutrients_food_id_idx` (the fan-out then scans ~1M value rows), one more `await` in the chain, or a growing per-food nutrient set all move it. SC-011 budgets the auth layer at ≤ 10ms **of** this 50ms.                                                                                                         |
| **serve rate > 80%** (`SERVE_RATE_MIN`)                                                                 | **SC-004** verbatim: "> 80% once the local store contains 5,000+ unique `RESOLVED` foods."                                                                                                                                                                                             | Anything that stops a `RESOLVED` food being served: a lifecycle write leaving resolved foods `PENDING`, `readGoldenRecord` returning `null` for a live row (mapped to `404`), or the read path erroring under pool exhaustion. See the operationalization note below.                                                                                                                                                                                                                                                                                                         |
| **> 1.389 served reads/sec** (`SERVED_READS_…`)                                                         | **SC-005**: "comfortably exceeding 5,000 served reads per hour" ⇒ 5,000 / 3,600.                                                                                                                                                                                                       | Total collapse of the read path (unresponsive service, every pooled connection blocked, container OOM-restart). A liveness floor, not a tight fit.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **> 85% of the offered arrival rate**                                                                   | Derived: the regression bar SC-005's absolute floor is too loose to provide.                                                                                                                                                                                                           | k6 dropping iterations because the bounded VU pool cannot keep up — i.e. the service failing to absorb the offered rate. 0.85 (not 1.0) because k6 divides a metric's count by the WHOLE test duration including `gracefulStop`, so a perfectly-keeping-up service still measures slightly under.                                                                                                                                                                                                                                                                             |
| **search p95 ≤ 200ms** (`SEARCH_P95_MS`)                                                                | **SC-007** verbatim: "within 200ms at p95" against "up to 50,000 foods". Applies to ALL seven shapes.                                                                                                                                                                                  | At 3+ characters `FoodSearchDao.search` ORs four predicates (ranked FTS, `name % query`, two `ILIKE '%q%'`) and ranks **every** match by `GREATEST(ts_rank, similarity(name, …))` before `LIMIT 20`, so cost tracks matched rows, not returned rows. At 1–2 characters (T-198) it is instead a prefix `to_tsquery('simple', '<token>:*')` over `food_search_vector_idx`, so what breaches the `short` shape is losing that index or reverting the routing. `FoodsService.search` additionally issues two crosswalk lookups on every search, so the endpoint is three queries. |
| **claim p95 ≤ 60ms + 15% = 69ms enforced** (`FOOD_DRAIN_CLAIM_P95_MS` × `CLAIM_P95_VARIANCE_ALLOWANCE`) | Derived from **SC-003** (60s p95 at depth < 100) — the full arithmetic is in `drain-demotion.perf.ts`'s docblock. The 60 is the contract; the +15% is the owner's 2026-08-12 variance allowance on perf metrics, kept a separate number so both stay visible (see Finding 2, Stage 3). | Anything that puts FR-043's fairness term back on a per-row footing in `leaseNext`: making the demotion a sort key again (pre-T-197, a correlated `COUNT(*)` as the LEADING `ORDER BY` key, which `LIMIT 1` cannot avoid and `idx_fetch_queue_priority` cannot serve), inlining the `demand` CTE so it re-runs per candidate row, or removing the `promoted_ready` gate so an empty promoted tier is proven by examining every eligible row (post-T-197, T-201). Also a lost `idx_fetch_queue_priority` or `idx_fetch_requesters_requester_id`.                               |
| **erasure p95 ≤ 500ms** (`ERASURE_P95_MS`)                                                              | The cross-service reference point (SC-009's single-row-write budget); no SQS hand-off, so tighter than recipe's.                                                                                                                                                                       | `fetch_requesters` losing `idx_fetch_requesters_requester_id`, turning the delete's row location into a scan of every queued food's requester rows.                                                                                                                                                                                                                                                                                                                                                                                                                           |

### How SC-004's "serve rate" is operationalized (read this before changing the mix)

SC-004 asks for "reads served from the local store **without any source call**". Taken literally that is
100% by construction — food's read path never reaches an adapter, on any status. So the measured definition
is the one that can actually fail: **the share of reads that return a golden record (`200`)**. A `202`
(PENDING/UNRESOLVED) or `404` (NOT_FOUND/FAILED) read returned no food data, so the caller must still wait
for a source fetch; it was not served locally.

The fixture seeds 5,000 `RESOLVED` read targets plus 500 `PENDING` and 500 tombstoned `NOT_FOUND` foods, and
the script reads 9 `RESOLVED` ids for every 1 unresolvable one. So the **fixture sets the ceiling at 90%**
and the 80% threshold fails once the system loses more than 1 in 9 of its local serves. Raising
`FOOD_UNSERVED_EVERY` above 5 would make the threshold unsatisfiable by construction — the same class of
mistake as a search needle that matches fewer rows than the endpoint's limit.

### Why `search.load.js` gates SEVEN shapes instead of one "search" number

Search cost tracks how many rows MATCH, not how many are returned, so one query string measures one point
on that curve and reports it as "search". The shapes (with their measured selectivity against 50,000 foods)
are `broad` (one ingredient, ~2,174 rows), `phrase` (~310), `narrow`, `brand` (~2,941), `miss` (zero rows —
the predicate cannot short-circuit on the limit), `short` (two characters — since T-198 the word-initial
prefix statement, and this shape is the LATENCY gate on it), and `barcode` (drives the crosswalk branch).
Each carries its own p95 threshold **at the same 200ms budget, with no per-shape exemption**, so a cheap
narrow query can never hide an expensive broad or short one. The vocabulary that produces those selectivities lives in
`perf-fixture.ts`, and the seeder ASSERTS the broad probe matches more than the endpoint's 20-row limit and
the miss probe matches exactly zero.

## Auth — no live Clerk instance is ever contacted

Every `/api/v1/foods/*` route is fronted by `FoodAuthGuard`, which verifies an RS256 Clerk session token
networklessly against a pinned public PEM and enforces `azp`. So `prepare-clerk-tokens.ts` generates a
**throwaway RSA keypair**, mints the pool locally, and writes the public half to `clerk-public-key.pem`; the
service under test is booted with `CLERK_JWT_KEY="$(cat …)"` and `CLERK_AUTHORIZED_PARTIES=https://food-load.test`
(exact-match list mode — the production posture, ADR-0001). That drives the REAL guard and the REAL `azp`
boundary with **zero** requests to Clerk, which is load-bearing: the shared sandbox Clerk dev instance is a
single per-IP rate limit, and minting a pool from one runner trips a multi-minute cool-down that reds CI for
reasons unrelated to food's performance. **Do not** "improve" this by using real Clerk tokens.

> 🔒 `clerk-tokens.json`, `clerk-public-key.pem`, `erasure-tokens.json` and `erasure-public-key.pem` are
> **generated, gitignored credential material** — live bearer tokens in a **public** repo. Never commit
> them, never `git add -f` them, and never echo token contents into CI logs (the prepare steps print counts
> and configuration only). They are also listed in this package's `.prettierignore`, because
> `format:check` runs `prettier --check .` with CWD = the package and therefore never reads the repo root's
> ignore file. `perf-fixture.json` is gitignored + prettier-ignored for the same practical reason (a ~180 KB
> machine-written blob), though it holds no secrets.

## Prerequisites

- The **k6 binary** — <https://grafana.com/docs/k6/latest/set-up/install-k6/>, or
  `npm run k6:install --workspace=packages/tools/loadtest`.
- A Postgres holding a **disposable** database with the food schema applied. The scripts REFUSE to run
  against any database not named `food_load` / `food_perf` / `food_it` unless
  `FOOD_PERF_ALLOW_NONSTANDARD_DB=true` — port 5432 on a workstation holds live databases, and the seeder
  writes ~180,000 rows.
    - The fixture seeder is **additive and never drops the schema** (unlike identity's `prepare-db.ts`),
      precisely so it can run while the service under test is already connected. Apply the DDL first:
      `for f in src/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done`.
- A running food-service reachable at `FOOD_API_BASE_URL`, booted with the generated public key(s).
  A **container** is the reliable way to boot it: `npx tsx src/main.ts` boots and answers `/health` but
  **fails Nest DI at request time** (`TypeError: Cannot read properties of undefined (reading 'getFood')` —
  esbuild does not emit the `emitDecoratorMetadata` the constructor injection needs), and a bare
  `node dist/main.js` cannot resolve the workspace `@kitchensink/*` bare specifiers (the shared packages
  export `./src`; the image COPYs their `prod.package.json` to repoint at `./dist`). Measured, not assumed.

## Configuration

| Variable                                          | Default                                       | Meaning                                                         |
| ------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `FOOD_API_BASE_URL`                               | `http://localhost:3000`                       | Base URL of the service under test                              |
| `FOOD_LOAD_PEAK_VUS`                              | `50`                                          | Peak concurrent VUs for the ramping scripts                     |
| `FOOD_LOAD_RAMP_UP` / `_HOLD` / `_RAMP_DOWN`      | `30s` / `1m` / `15s`                          | Load shape                                                      |
| `FOOD_READ_P95_MS`                                | `50`                                          | SC-001 read budget                                              |
| `FOOD_SERVE_RATE_MIN`                             | `0.8`                                         | SC-004 serve-rate floor                                         |
| `FOOD_UNSERVED_EVERY`                             | `10`                                          | 1-in-N reads target an unresolvable food (sets the 90% ceiling) |
| `FOOD_SERVED_READS_PER_SECOND_MIN`                | `1.389`                                       | SC-005 absolute floor (5,000/hour)                              |
| `FOOD_READ_ARRIVAL_RATE`                          | `100`                                         | Offered arrival rate for the throughput scenario                |
| `FOOD_SUSTAIN_FRACTION`                           | `0.85`                                        | Fraction of the offered rate the service must absorb            |
| `FOOD_THROUGHPUT_PREALLOCATED_VUS` / `_MAX_VUS`   | `20` / `100`                                  | VU pool for the arrival-rate executor (bounded on purpose)      |
| `FOOD_SEARCH_P95_MS`                              | `200`                                         | SC-007 budget — ONE bar for all seven shapes, no exemption      |
| `FOOD_ERASURE_P95_MS`                             | `500`                                         | CR-002/U4b erasure budget                                       |
| `FOOD_TOKEN_POOL_SIZE` / `FOOD_TOKEN_TTL_SECONDS` | `50` / `3600`                                 | Clerk pool size / lifetime                                      |
| `FOOD_LOAD_AZP`                                   | `https://food-load.test`                      | The `azp` minted tokens claim (must match the service's list)   |
| `FOOD_PERF_RESOLVED_FOODS`                        | `50000`                                       | SC-007 population size                                          |
| `FOOD_PERF_READ_TARGETS`                          | `5000`                                        | SC-004 warm-store size; the ids with full golden records        |
| `FOOD_PERF_PENDING_FOODS` / `_NOT_FOUND_FOODS`    | `500` / `500`                                 | The not-served side of the SC-004 ratio                         |
| `FOOD_DRAIN_DEPTHS`                               | `100,1000,10000`                              | Queue depths the drain probe measures                           |
| `FOOD_DRAIN_SAMPLES` / `_MIN_SAMPLES`             | `30` / `5`                                    | Claims per series / floor when the wall-clock budget bites      |
| `FOOD_DRAIN_SERIES_BUDGET_MS`                     | `60000`                                       | Per-series wall-clock budget (an early stop is always printed)  |
| `FOOD_DRAIN_CLAIM_P95_MS`                         | `60`                                          | Per-claim budget derived from SC-003                            |
| `FOOD_TOKENS_FILE` / `FOOD_PERF_FIXTURE_FILE`     | `./clerk-tokens.json` / `./perf-fixture.json` | Generated inputs — **entry-script-relative**, see below         |

⚠️ **k6's `open()` resolves relative to the ENTRY SCRIPT'S DIRECTORY** — not the process cwd, and **not** the
module that calls `open()`. Measured on k6 v0.54.0: a `'../perf-fixture.json'` inside `lib/common.js` (one
directory deeper than the scripts) resolved to `tests/perf-fixture.json`, i.e. relative to `tests/load/`.
That is why the defaults are `./…` despite living in `lib/`. Do not "fix" them to match the helper's own
location, and do not make them cwd-relative — `k6 run` must work identically from the package directory and
from the repo root.

## Running

```bash
cd packages/services/food-service
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_load

# 0. One-time: create the disposable DB and apply the ordered DDL.
createdb food_load
for f in src/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done

# 1. Mint the token pools (both are gitignored, so they are never present from a checkout).
npm run test:load:tokens            # Clerk RS256 pool for the SC scripts
npm run test:load:erasure-tokens    # EdDSA pool for the erasure scenario

# 2. Boot the service from its production image, trusting both generated public keys.
npx turbo run build --filter=@kitchensink/food-service
npm run docker:prepare && docker build -f Dockerfile -t food-load:local ../../..
docker run -d --name food-load --network host \
    -e NODE_ENV=development -e STAGE=load -e PORT=3000 -e USDA_API_KEY=dummy \
    -e DATABASE_URL="$DATABASE_URL" \
    -e CLERK_JWT_KEY="$(cat tests/load/clerk-public-key.pem)" \
    -e CLERK_AUTHORIZED_PARTIES=https://food-load.test \
    -e FOOD_SERVICE_PRINCIPAL_JWT_KEY="$(cat tests/load/erasure-public-key.pem)" \
    food-load:local

# 3. Seed the 50,000-food store (additive; ~15s).
npm run test:load:fixture

# 4. Run the suite.
FOOD_API_BASE_URL=http://localhost:3000 npm run test:load    # the three SC k6 scripts
npm run test:load:drain                                       # SC-003 / DSN-11 (no HTTP service needed)
```

### ⚠️ Script ORDER is load-bearing

1. **`service-erasure.load.js` runs FIRST.** Its EdDSA pool lives 120s (the verifier's contract maximum),
   and the fixture seed between the scripts takes ~15s+, so any later slot risks racing the TTL.
2. **`drain-demotion.perf.ts` runs LAST.** It is the only write-heavy step (up to 10,000 queue rows and
   30,000 requester rows, repeatedly), so running it earlier leaves Postgres autovacuuming and checkpointing
   _during_ the read-sensitive scripts. Identity's suite records a measured ~130× artefact from exactly this
   ordering mistake; the same hazard applies here.
3. The three SC k6 scripts are read-only and mutually independent, but `local-store-throughput.load.js` is a
   **separate script** from `local-store-read.load.js` on purpose: two scenarios hammering the same read path
   in one script contend for the 20-connection pool, so neither the latency nor the throughput number would
   be attributable.

## Baseline (measured, LOCAL WORKSTATION — these are NOT deployed numbers)

One pass on 2026-08-08: the service in its production Docker image against a local Docker Postgres 16, all
on one developer workstation (WSL2), k6 v0.54.0, 50 peak VUs, 51,000 foods (50,000 `RESOLVED`) / 100,000
nutrient values / 15,000 portions. **These are not deployed numbers** — a `512`-CPU-unit Fargate task
talking to RDS over the network with TLS will be materially slower, and this workstation is also running
other containers. Treat the deployed p95s as UNVALIDATED until the CI job (or a sandbox run) reports them.

| Criterion  | Measurement                                                | Budget    | Verdict                       |
| ---------- | ---------------------------------------------------------- | --------- | ----------------------------- |
| **SC-001** | `GET /foods/{id}` (RESOLVED) p95 **4.00ms**, p99 4.55ms    | ≤ 50ms    | PASS (12× headroom)           |
| **SC-004** | local-store serve rate **90.49%** (3,734 / 4,126)          | > 80%     | PASS (at the 90% ceiling)     |
| **SC-005** | **94.30 served reads/s** = 339,474/hour, p95 3.34ms        | > 1.389/s | PASS (68× the bar)            |
| **SC-007** | aggregate search p95 **160 / 156 / 156ms** over 3 runs     | ≤ 200ms   | PASS; 1 shape breached once   |
| **SC-003** | drain claim p95 **7.00ms** at depth 100                    | ≤ 60ms    | PASS at the contract depth    |
| **DSN-11** | drain claim p95 **540ms** @ 1,000 / **7.5–11.0s** @ 10,000 | ≤ 60ms    | **FAIL — flagged, see below** |

Per-shape search p95 across three runs, all against the single 200ms budget:

| Shape     | run 1          | run 2      | run 3      | Notes                                                                     |
| --------- | -------------- | ---------- | ---------- | ------------------------------------------------------------------------- |
| `barcode` | 11.36ms        | 5.77ms     | 5.67ms     | crosswalk branch; indexed                                                 |
| `miss`    | 8.68ms         | 4.48ms     | 4.52ms     | zero matches; nothing to rank                                             |
| `broad`   | 42.25ms        | 22.71ms    | 23.17ms    | ~2,174 rows ranked                                                        |
| `brand`   | 63.75ms        | 23.27ms    | 24.09ms    | ~2,941 rows ranked                                                        |
| `narrow`  | 105.07ms       | 68.23ms    | 68.39ms    | 3-lexeme AND + a long `ILIKE` pattern — more index intersection, not less |
| `phrase`  | 130.89ms       | 52.58ms    | 52.07ms    |                                                                           |
| `short`   | **205.56ms** ✗ | 160.04ms ✓ | 159.53ms ✓ | **the only shape with no index at all — see the finding below**           |

### 🟠 Finding 1 (SC-007): a 2-character query sequentially scans the whole table

`short` is the only shape that ever breached: 205.56ms p95 (p99 1.02s, max 2.51s) on run 1, then 160.04ms
and 159.53ms on runs 2 and 3. Run 1 was taken while other work was still on the box, so the 205ms figure is
partly workstation noise — **the finding is not the one breach, it is the plan**. `EXPLAIN (ANALYZE, BUFFERS)`
for `query=ch` shows a **`Seq Scan on food`**: 51,000 rows scanned, 42,305 removed by filter, 8,695 matched,
4,250 shared buffers, **157.99ms of execution time and no index used at all**. The same query for `chicken`
is a `BitmapOr` over `food_search_vector_idx` + `food_name_trgm_idx` (×2) + `food_description_trgm_idx` at
**19.8ms**. So `short` sits at ~160ms against a 200ms budget — **~20% headroom, versus 8–35× for every other
shape** — and the ~158ms is almost entirely irreducible DB execution time, not queueing.

The cause is `pg_trgm`: a 2-character pattern yields no complete trigram, so `name ILIKE '%ch%'` /
`description ILIKE '%ch%'` cannot be index-served and the planner falls back to a full scan plus a per-row
`similarity()` computation. SC-007 grants no exemption for short queries, and this is the query shape a real
user produces after two keystrokes. Because the cost is a full scan it grows LINEARLY with the RESOLVED
population (this is 50,000; SC-007's ceiling), and on deployed hardware — a 512-CPU-unit Fargate task
reaching RDS over TLS rather than a workstation reaching a local container — it will be slower than 158ms.
**Treat SC-007 as AT RISK for queries under 3 characters, and as unvalidated on deployed hardware for all of
them.**

The fix is in `FoodSearchDao.search`, not in the budget: gate the two `ILIKE` branches behind
`length(query) >= 3` (below that they are also nearly useless for relevance), or enforce a minimum query
length at the boundary. That is a search-semantics change (FR-008/FR-010) and belongs to a `be-1` task, not
to this measurement.

#### ✅ Resolved by T-198 (2026-08-09) — and the exemption this finding justified is gone

Fixed as ROUTING rather than gating: 1–2 character queries now run a word-initial prefix statement,
`search_vector @@ to_tsquery('simple', '<token>:*')`, over the `food_search_vector_idx` GIN index the schema
already had (no migration, no new index). Measured on the same 50,000-food store: `ch` **134.2ms → 6.2ms**,
`b` **156.5ms → 13.6ms**, `be` **125.8ms → 3.9ms**; worst case over all 26 single letters on this fixture's
(pessimistically verbose) shape is **32.6ms**, i.e. 6.1× headroom instead of ~1.2×. The full evidence table,
the semantic change, and the two rejected index designs are recorded under "T-198 — measured evidence" in
`specs/003-usda-food-data/tasks.md`.

Two consequences for this suite:

1. **`FOOD_SEARCH_SHORT_P95_MS` is DELETED.** It defaulted to 200ms, so it never loosened anything by
   itself, but its only possible use was to raise the `short` shape above SC-007 — and the finding it was
   created for no longer exists. All seven shapes now read `SEARCH_P95_MS`. Per-shape attribution is
   unchanged (it comes from the `{shape:…}` threshold tag).
2. **k6 is no longer the primary guard on this path, because it is HEAVY-TIER.** `load-test-food` runs only
   nightly, on manual dispatch, or on a PR carrying `heavy-e2e`, so a guard that lives only here does not
   run on an ordinary PR. The routing and the statement shape are therefore pinned by tiers that run on
   EVERY PR — `src/foods/dao/__tests__/food-search.dao.test.ts` (unit: the strategy selection AND the
   rendered SQL, asserting the `ILIKE '%q%'` branches are absent at 1–2 characters) and
   `tests/food-search.dao.integration.test.ts` (real Postgres: word-initial recall, the stopword traps, the
   metacharacter safety, and the mid-word matches that must now be gone). What remains k6-only is a
   regression whose symptom is **time rather than statement shape** — principally a dropped
   `food_search_vector_idx` or growth past the 50,000-food ceiling.

### ✅ Finding 2 (DSN-11), CLOSED IN THREE STAGES: the drain claim stays within the SC-003 budget

Measured with `FetchQueueDao.leaseNext()` called directly (the shipped SQL, never a copy). Kept as a record
rather than deleted, because the stages failed in different ways: the second hid behind a stale description of
the first, and the third was **not a query defect at all** — it was this probe's own p95 estimator converting
runner noise into a contract breach. Read all three before concluding anything from a red here, and compare
MEDIANS across runs before touching the statement.

**Stage 0 — as originally shipped (T-195's finding).** FR-043's demotion was a per-requester correlated
`COUNT(*)` in the LEADING position of the `ORDER BY`. A computed leading sort key must be evaluated for every
eligible row before the first row is known, so `LIMIT 1` could not avoid it and `idx_fetch_queue_priority`
was unusable:

| Profile       | Depth  | requester rows | demoted | p95      |
| ------------- | ------ | -------------- | ------- | -------- |
| `mixed`       | 100    | 200            | 0       | 7.00ms   |
| `mixed`       | 1,000  | 2,800          | 0       | 540.83ms |
| `mixed`       | 10,000 | 30,000         | 0       | 7,562ms  |
| `adversarial` | 100    | 100            | 100     | 6.69ms   |
| `adversarial` | 1,000  | 1,800          | 1,000   | 458.74ms |
| `adversarial` | 10,000 | 20,000         | 10,000  | 10,991ms |

Two things this settled that a single-profile test could not: the blow-up was **not** driven by demotion
firing (`mixed`, with nothing demoted, was as slow or slower — it carries 50% more requester rows), and the
cost tracked `depth × requesters-per-food × pending-rows-per-requester`, i.e. exactly the fan-out FR-043
exists to manage.

**Stage 1 — T-197.** The fairness term became a `WHERE` filter over an `over_demand AS MATERIALIZED` CTE
computed once per claim, which restored the index and the early termination. Ceiling cost fell from seconds
to tens of milliseconds. One case stayed linear in depth, though, and **CI caught what a local run did not**:
with NOTHING promoted the promoted branch still had to examine every eligible row before it could conclude
its tier was empty. CI measured `adversarial` @10,000 at **85.52ms p95 against the 60ms budget** where the
dev machine measured 28.66ms — a ~3× hardware gap, and the reason T-197's "5–9ms locally, no materialization
needed" reasoning did not survive.

**Stage 2 — T-201.** `over_demand` is now derived from a `demand` CTE that keeps each requester's
over-threshold boolean (so `FOOD_DEMOTE_THRESHOLD` is still stated exactly once in the statement), and the
promoted branch is gated on a `promoted_ready` probe that answers "is any requester under the threshold AND
holding eligible work" from that aggregate — bounded by the DISTINCT-REQUESTER count, not by queue depth. An
empty promoted tier therefore leaves the branch `never executed` instead of walking the queue. Locally,
through the real DAO, before → after:

| Profile       | Depth  | p95 before | p95 after |
| ------------- | ------ | ---------- | --------- |
| `mixed`       | 10,000 | 8.86ms     | 9.04ms    |
| `adversarial` | 1,000  | 6.97ms     | 4.03ms    |
| `adversarial` | 10,000 | 41.70ms    | 7.20ms    |

**What is still true.** SC-003 itself was never breached: its promise is conditioned on "pending-row depth
under 100 rows", and the depth-100 gate has passed with >8× headroom at every stage. What Stage 0 exposed —
that FR-046 permits a depth at which SC-003 would become unachievable — is what Stages 1 and 2 closed. The
claim remains linear in `fetch_requesters` ROWS (one aggregate has to read them to know each requester's
outstanding count); it is no longer linear in QUEUE DEPTH, which is the quantity FR-046 bounds. Removing the
remaining term would need a maintained per-requester counter, i.e. a second representation of the same
number — the T-199a split-brain by construction — and it is not justified at the measured cost.

**Confirmed on CI** (run 31451860784, the runner that produced the Stage-1 breach), before → after:

| Profile       | Depth  | p95 before | p95 after |
| ------------- | ------ | ---------- | --------- |
| `mixed`       | 100    | 4.78ms     | 4.87ms    |
| `mixed`       | 1,000  | 3.98ms     | 5.46ms    |
| `mixed`       | 10,000 | 16.73ms    | 16.59ms   |
| `adversarial` | 100    | 2.64ms     | 2.65ms    |
| `adversarial` | 1,000  | 10.76ms    | 3.91ms    |
| `adversarial` | 10,000 | 85.52ms ✗  | 10.81ms ✓ |

The breaching series is 7.9× faster and sits 5.6× inside the budget. Note the local prediction was 7.20ms
against CI's 10.81ms: the ~3× hardware factor applies to the REMAINING per-claim aggregate too.

**Stage 3 — 2026-08-12: the probe red-flagged a 5.4× "regression" that did not exist. The estimator was the
defect, not the query.** Run 31608073724 reported `mixed` @10,000 at **90.23ms p95 against the 60ms budget**,
and the obvious reading — a query-shape regression in the promoted branch, since `adversarial` was unaffected
— was wrong. Read the MEDIAN column instead:

| run                                | p50         | p95         | p99 = max |
| ---------------------------------- | ----------- | ----------- | --------- |
| 31451860784 (the confirming run)   | 15.69ms     | 16.59ms     | 16.97ms   |
| 31542581165                        | 15.14ms     | 15.41ms     | 15.65ms   |
| 31553227712                        | 16.58ms     | 18.01ms     | 18.30ms   |
| 31537195430                        | 11.84ms     | 12.36ms     | 41.96ms   |
| **31608073724** (the "regression") | **12.23ms** | **90.23 ✗** | 114.96ms  |

The breaching run had the **second-fastest median ever recorded** for that series — 22% faster than the run
the budget was confirmed on. The statement, its plan, its `never executed` branch and its buffer counts were
all unchanged (verified by `EXPLAIN (ANALYZE, BUFFERS)` on the statement captured from the DAO, and by both
committed gates passing unmodified). Two mechanisms combined:

1. **`percentile()` at n=30 made "p95" the second-largest sample**, and "p99" the maximum, definitionally —
   which is why `p99 == max` in every row of every table above, arithmetic rather than a property of the
   queue. Two slow samples out of thirty therefore decided the verdict, so the gate's real sensitivity was set
   by the host and not by the query. **Fixed:** the default is now 300 samples, where p95 is the 16th-largest
   observation. The budget, the fixture, the profiles and the depths are unchanged — the same quantity is
   simply estimated with enough samples to mean what it says. Cost at depth 10,000: sampling 0.35s → 3.0s per
   series against ~18s of seeding, i.e. the two-profile run went 38.4s → 42.1s.
2. **Host stalls of 30–170ms occur on the runner.** In the same run, `adversarial` @1,000 measured p50 3.55ms
   with p95 29.37ms; in run 31537195430, `mixed` @**100** measured p50 2.31ms with p95 **56.51ms** — 94% of
   the budget at the depth where SC-003 actually binds, where the statement does ~2ms of work and no plan can
   explain 56ms. That example is the important one: the estimator could red the **SC-003 gate itself** on
   noise. Contamination is also time-localised rather than series-specific — in the failing run, series 1 and
   4 were clean while series 2 and 3 were contaminated, spanning a series boundary, and a cost regression
   cannot be heavier at depth 1,000 than at 10,000 for the same profile.

Reproduced locally, so this is not a CI peculiarity: with medians of 8–10ms at depth 10,000, single samples of
**62.63ms and 73.78ms** were observed, and two 300-sample measurements of the identical fixture minutes apart
returned p95 **32.28ms and 7.60ms**. The plausible innocent explanation — this harness's own fixture churn,
since every series bulk-deletes and re-inserts tens of thousands of rows — was **measured and rejected**: 300
samples either side of an explicit `VACUUM (ANALYZE)` moved p50 by 0.2–0.4ms (6.64 → 6.40 `adversarial`,
9.89 → 9.48 `mixed`) and `autovacuum_count` did not advance during either phase.

**Stated rather than implied: the SOURCE of the stalls on GitHub's runners is NOT diagnosed** — CPU steal
versus IO contention cannot be told apart from inside the job. What is established is that the stalls exist,
that they are not the query, and that they are not this fixture's vacuum state.

**Where the cost actually is** (`EXPLAIN (ANALYZE, BUFFERS)`, freshly-seeded depth-10,000 fixture, this
workstation) — recorded because the wrong diagnosis is the tempting one:

| series        | statement | buffers | `demand` aggregate | branch 1 (promoted tier)         |
| ------------- | --------- | ------- | ------------------ | -------------------------------- |
| `mixed`       | 8.889ms   | 755     | 7.239ms (81%)      | 1.547ms (1.521ms of it the hash) |
| `adversarial` | 5.356ms   | 328     | 5.224ms (97%)      | `never executed`                 |

Branch 1 — the tier `adversarial` never enters, and therefore the natural suspect for a `mixed`-only
regression — is **~17% of the statement**, and 98% of _that_ is building the 50-row hashed `over_demand`
SubPlan once; the index scan itself is 0.003ms at `rows=1 loops=1`. The FR-043 aggregate is 81–97% of the
statement. The `mixed`/`adversarial` delta is that aggregate reading 30,000 versus 20,000 `fetch_requesters`
rows (727 vs 311 buffers), not the promoted tier.

**Also corrected here: the 328 buffers above versus the 1,439 recorded in Stage 2.** Same statement, same
depth — the 1,439 was measured against a CI-style database the k6 steps had already churned, so the tables
carried roughly 5× the pages for the same rows. Nothing asserts on either figure; the scaling gate asserts
index TUPLES, which bloat does not move.

**What was deliberately NOT done:** `FOOD_DRAIN_CLAIM_P95_MS` is still 60, the fixture is unchanged, no
`continue-on-error` was added, and no SQL was modified. A re-measure-before-failing gate (fail only if a
breaching series breaches again) was proposed and the owner **ruled against it**; there is no stub, flag or
dormant code path for it.

**Owner ruling 2026-08-12 — a ±15% variance allowance on perf metrics, and what it does not buy.** Verbatim:
_"I think we have to account for and allow variations with plus/minus 15% on perf metrics."_ This is the
general form of the SC-007 ruling of 2026-08-10 ("a p95 measured on shared CI hardware needs a stated
allowance for run-to-run variance, and a gate that reds on hardware noise trains everyone to ignore red
gates"). Implemented as its own constant, so both numbers stay visible:

| number                         | value    | where it comes from                                     |
| ------------------------------ | -------- | ------------------------------------------------------- |
| `CLAIM_P95_BUDGET_MS`          | 60ms     | SC-003 arithmetic: 10% of the 600ms per-item drain slot |
| `CLAIM_P95_VARIANCE_ALLOWANCE` | 15%      | owner ruling 2026-08-12 (measurement-noise judgement)   |
| `EFFECTIVE_CEILING_MS`         | **69ms** | derived from the two, printed on every series           |

The 15% is **not** folded into the 60 — the 60 must stay visibly derived from the contract and the 15% visibly
a judgement, and a lone `69` would read as a quietly raised budget. It is not env-overridable either, since
`FOOD_DRAIN_CLAIM_P95_MS` already exists for exploration and a second loosening knob is a second way to lose
the number.

⛔ **The honest arithmetic: ±15% would NOT have prevented the red above.** 60 × 1.15 = 69ms; the failing run
measured **90.23ms**, which is 50% over budget, not 15%. What removed that false red is the **n=300** change —
the worst contaminated p95 measured at n=300 was **32.28ms**, inside 60ms, let alone 69ms. The allowance is a
stated margin on top of an honest estimator, never the thing that makes the estimator honest.

**Depth-100 consequence, and the alternative.** "Perf metrics" was stated generally, so the allowance applies
at every depth **including depth 100**, where SC-003 binds: the effective claim allowance becomes 69ms, i.e.
**11.5% of the per-item drain slot rather than 10%**. That is a small but real loosening of a contract gate, so
it is recorded in `specs/003-usda-food-data/spec.md` next to SC-003 rather than only here. The alternative —
hard 60ms at depth 100, ±15% only above it — is flagged there for the owner.

**Residual, narrowed rather than closed:** n=300 makes p95 resolve the contracted quantity and ±15% absorbs
the ordinary spread on top; a contamination episode large enough to move the **16th-largest of 300** samples
past 69ms would still red the job. Accepted risk, with a number on it.

**Local numbers are not evidence about CI** (~3× slower), which is why the invariants that hold regardless of
hardware are asserted separately: `tests/drain-claim-ranking-differential.integration.test.ts` proves the
ranking is unchanged against FR-043 stated literally, and `tests/drain-claim-scaling.integration.test.ts`
asserts from the real `EXPLAIN` plan that the claim pulls O(1) tuples from `idx_fetch_queue_priority` when
nothing is promoted. `FOOD_DRAIN_CLAIM_P95_MS` exists for exploration; **raising it changes the reported
number, not the drain rate.**

### 🟢 Finding 3 (SC-007), CLOSED 2026-08-11: `narrow` and `phrase` had ~10% margin; the access path was the cost

Finding 1 said to "treat SC-007 as AT RISK … and as unvalidated on deployed hardware". That has now been
measured, and two shapes are over budget on the CI runner — not the `short` shape Finding 1 was about, which
T-198 fixed and which now measures 51.66ms.

| Shape    | workstation (3 runs) | CI 31323016643 | CI 31451273786 | CI 31451860784 |
| -------- | -------------------- | -------------- | -------------- | -------------- |
| `narrow` | 105.07 / 68.2 / 68.4 | 196.73 ✓       | 258.74 ✗       | 253.10 ✗       |
| `phrase` | 130.89 / 52.6 / 52.1 | 152.41 ✓       | 185.20 ✓       | 206.29 ✗       |

Read together with the drain-claim numbers above, this is the SAME lesson twice: CI measures ~2.5–3.8×
slower than the workstation these budgets were validated on, so a shape that lands at 68ms locally lands at
~200–255ms there. `narrow` passed its first CI run by 1.7% and has failed both since; `phrase` has now
crossed as well. This is a MARGINAL BUDGET, not a flake — the distributions barely move run to run
(`narrow` avg 145.6 → 156.4 → 154.2ms), only the p95 tail crosses.

**Not attributable to the T-197/T-201 drain work**: nothing in those changes touches `FoodSearchDao`, the
search indexes, or the fixture, and the drain claim runs in a separate process after the k6 scripts.

**RESOLVED 2026-08-10 by owner ruling** — SC-007 became 250ms p95 ±15% (ceiling 287.5ms), which every observed run clears. The reasoning below stood while 200ms was the criterion and is kept because it still governs any FUTURE widening: what must NOT be done is raise the budget without an owner ruling and a measurement. The 200ms came from SC-007 verbatim, and
widening it changes the reported number rather than the latency — the same rule that governs
`FOOD_DRAIN_CLAIM_P95_MS`. The fix belongs in the search path, and per T-198 any change to which rows match
(or their order) needs a product call rather than a DAO edit. `narrow` is a 3-lexeme AND plus a long `ILIKE`
pattern, so the index intersection and the per-row `GREATEST(ts_rank, similarity(…))` ranking over every
matched row are where the time goes; the candidate that changes no semantics is to stop ranking rows that
cannot reach the `LIMIT 20`.

**Consequence while it was open:** the `Load test (food — k6)` job was RED, and it failed at the search step —
which is why both drain-claim steps now carry `if: ${{ !cancelled() }}` (see `_ci-heavy.yml`). Without that,
a search breach silently skipped the FR-046 probe and the run reported no drain number at all.

**CLOSED 2026-08-11 (T-202) — the headroom came from the ACCESS PATH, and the ticket's hypothesis was wrong.**
Ranking is not the cost: `narrow` matches 364 rows and the top-N heapsort over them is **0.14ms of a 45.8ms
statement**. 66% of the statement is the `name % query` branch, where `food_name_trgm_idx` (GIN) answers the
operator with **9,758 candidate rows for 368 true matches** and the bitmap heap scan then re-runs the
predicate — a fresh `similarity()`, measured at 2.19µs — on the 9,754 it discards. Migration `0004` adds a
**GiST** trigram index on the same column, which answers it with 368 candidates. An index cannot change a
result (the operator is rechecked from the heap); proved over 932 probes on two 50,000-row fixture shapes
against a pure Seq Scan, and pinned per-PR by `tests/food-search-access-path.integration.test.ts`. Local DB
time, on the fixture CI seeds and in CI's build order (migration first, so the index is built by the bulk
INSERT rather than packed by a later `CREATE INDEX`): `narrow` 45.8 → 14.6ms, `phrase` 44.4 → 11.1ms,
`broad` 17.7 → 15.0ms, with `brand` 11.5 → 19.5ms and `miss` 0.12 → 6.7ms deliberately traded — GiST scans
its whole index whatever the needle, so a cost that tracked pattern length (0.12–45.8ms) becomes a flat
7–20ms band, which is the right shape for a p95 gate: it caps the tail, and the worst shape falls from 45.8ms
to 19.5ms. Full evidence, the rejected alternatives (removing either branch, a UNION rewrite, a query-plan
cost gate) and the mutation results are in `specs/003-usda-food-data/tasks.md` → "T-202 — measured evidence".

**CI-MEASURED, before and after** — the only arbiter of this gate, since this workstation runs ~4.4× faster.
Both runs are the same 50-VU profile against the same 50,000-food fixture on GitHub-hosted runners; before =
run 31454689817 (job 93666141627, the last green run on the old access path), after = run 31459435996 (job
93680080158).

| shape                          | p95 before | p95 after   | p99 before | p99 after | max before | max after |
| ------------------------------ | ---------- | ----------- | ---------- | --------- | ---------- | --------- |
| `narrow`                       | 209.90ms   | **42.42ms** | 253.69ms   | 45.82ms   | 294.94ms   | 47.45ms   |
| `phrase`                       | 158.39ms   | **29.42ms** | 222.23ms   | 32.60ms   | 256.04ms   | 52.69ms   |
| `broad`                        | 71.78ms    | 35.18ms     | 114.56ms   | 38.56ms   | 138.24ms   | 66.81ms   |
| `brand`                        | 64.23ms    | 43.95ms     | 83.72ms    | 47.86ms   | 135.11ms   | 58.82ms   |
| `short`                        | 44.46ms    | 44.70ms     | 87.06ms    | 66.88ms   | 121.56ms   | 81.22ms   |
| `miss`                         | 6.53ms     | 18.64ms     | 9.91ms     | 21.16ms   | 22.68ms    | 43.14ms   |
| `barcode`                      | 11.45ms    | 16.36ms     | 15.62ms    | 18.81ms   | 23.60ms    | 26.75ms   |
| **aggregate (the SC-007 p95)** | 154.33ms   | **39.81ms** | 207.87ms   | 46.44ms   | 294.94ms   | 81.22ms   |

**Headroom against the 287.5ms ceiling went from 1.37× to 6.4×.** The gated quantity is the worst shape, and
that is now `short` at 44.70ms rather than `narrow` at 209.90ms — a **4.7× improvement in the number the gate
actually tests**. The tail moved even more than the p95: `narrow`'s max was **294.94ms, ABOVE the ceiling**
(only p95 is asserted, so it passed), and is now 47.45ms.

Two things the local measurements got wrong, both in the same direction:

- **`brand` did not regress on CI, it improved 64.23 → 43.95ms**, where locally it went 11.5 → 19.5ms. At 50
  VUs the runner is partly contention-bound, so cutting total CPU across the rotation helps every shape —
  including the ones whose isolated cost rose. `miss` (6.5 → 18.6ms) and `barcode` (11.5 → 16.4ms) did regress
  as predicted, and are 15× and 18× inside the ceiling.
- **The whole suite now lands in a 16–45ms band** (was 6.5–210ms), which is the flat-tail property the GiST
  trade was chosen for, measured end to end rather than argued.

### 🔴 Finding 4 (SC-007), OPEN: `similarity()` is 100× under-costed, so the planner picks a Seq Scan on a production-shaped store — and this fixture hides it

Two problems that only show up together, both found while measuring T-202. **Neither is fixed**; each needs
an owner call, and they must move together.

1. **`similarity()` and the `%` operator's `similarity_op` both carry Postgres' default `procost` of 1**,
   while a call measures **2.19µs** — roughly 100× a simple operator. So the planner does not know that
   "Seq Scan and filter" means one `similarity()` per row, and its choice for this statement flips with table
   size and name diversity: Seq-Scan-and-filter at 6,000 rows, trigram BitmapOr at 12,000, Seq Scan again at
   25,000, BitmapOr at 50,000. On a **production-shaped** 50,000-food store it picks the Seq Scan and
   `narrow` measures **145.4ms locally** — 3× the 45.8ms this fixture produces — and the new GiST index buys
   nothing there because it is never chosen. `ALTER FUNCTION similarity(text, text) COST 100` plus the same
   for `similarity_op` flips it and is **strictly better on every shape**: `narrow` 145.4 → 15.6ms, `phrase`
   128.1 → 11.5ms, `broad` 118.8 → 15.0ms, `brand` 124.6 → 17.4ms, `miss` 119.8 → 6.5ms. Not shipped because
   `ALTER FUNCTION` needs ownership of a pg_trgm-owned function (the in-VPC migration runner only needs
   `CREATE EXTENSION IF NOT EXISTS` today, so a privilege failure there would break every migration), it
   changes plans for every query in the database, and `ALTER EXTENSION pg_trgm UPDATE` silently resets it.
2. **This fixture is not production-shaped, and that is what hides (1).** `perfFoodDescription` writes
   verbose prose, justified in its docblock as keeping the trigram/FTS indexes "as large as the deployed
   store". That justification is inverted: **production sets `description := name`** (`usda.adapter.ts`,
   `usda-bulk.parser.ts`), so the deployed `food_description_trgm_idx` indexes the name's trigrams and
   `search_vector` indexes the name's words twice. The prose makes `food` ~6× larger in pages, which makes a
   Seq Scan look expensive and pushes the planner onto the BitmapOr — the fixture accidentally gets the GOOD
   plan. Correcting it would make the reported CI numbers WORSE until (1) is fixed, which is why this is one
   finding and not two tickets.

**Consequence while it is open:** SC-007 is validated against a store shape production does not have. The
gate is honest about the query, not about the plan production will get once the store is populated from the
USDA pipeline.

## CI

Wired into the existing `load-test-food` job in `.github/workflows/_ci-heavy.yml`, gated behind the same
`run_load_test` input as the recipe and food erasure runs, so it never fires on an ordinary PR pipeline
(nightly / manual / the `heavy-e2e` PR label). The job mints BOTH token pools itself — they are gitignored,
so it can never assume they exist — boots one container trusting both public keys, then runs erasure → seed
→ read → throughput → search → drain (contract) → drain (ceiling). Every k6 run exports a summary and the
`Upload k6 summaries` step collects `k6-*-summary.json`.

The drain probe is split into two steps on purpose:

- **`Drain-claim SC-003 contract gate (depth 100)`** — the regression bar for the contract. Green today.
- **`Drain-claim FR-046 ceiling probe (depths 1000+10000)`** — the measurement T-195's acceptance requires.
  **This step is RED as it lands, and that red IS the DSN-11 flag.** It carries no `continue-on-error` and no
  `|| true`: a step reporting success for a 12-second drain claim is precisely the silent-green failure class
  this repo has already paid for. Resolve it by implementing DSN-11 — not by widening the budget, and not by
  deleting the step.
