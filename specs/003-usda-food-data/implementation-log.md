# Implementation Log — Feature 003 (source-agnostic food data)

Chronological record of implemented slices: the Test-first tasks covered, the Red-gate (confirmed
failing-for-the-right-reason) evidence, and the Green result. Newest entries at the bottom.

---

## 2026-06-29 — Phase 1 slice: SCHEMA + MIGRATION (T-100, T-101, T-102, T-103, T-104, T-111)

**Scope.** The Drizzle schema + single ordered hand-authored migration for all 13 canonical +
operational tables, plus the rewritten schema integration test. NO downstream work (no DAOs T-105+,
no service/controller/worker/adapter). Per plan.md §2 (canonical DDL) and decision-register D-\* the
authoritative spec.

**Test-first tasks covered (red-gate):** T-100 (Drizzle schema canonical core + 5 enums), T-101
(operational tables incl. `fetch_queue.leased_at`), T-102 (migration: canonical core + constraints
incl. D-PROVENANCE-FK), T-103 (migration: operational tables), T-104 (migration: indexes — search +
lifecycle + queue + limiter), T-111 (`food_candidates` — the 13th table).

**Harness.** Docker Postgres `postgres:16` from `infra/localstack/docker-compose.yml`
(`food_e2e` DB), `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/food_e2e`, Node v24,
`vitest run tests/schema.integration.test.ts --config vitest.integration.config.ts`. The test applies
the ordered migration SQL directly to a clean `public` schema and probes constraints — it does NOT
import the service code, so it is independent of the `foods/*` typecheck gap below.

### Red gate (confirmed failing for the right reason)

Ran the NEW hardened-schema test against the OLD migration (`foods` denormalized / `fdc_id` PK /
`usda_*` tables) BEFORE implementing:

```
FAIL  tests/schema.integration.test.ts > kitchensink_food schema (integration)
error: relation "food" does not exist
 ❯ seed tests/schema.integration.test.ts:82  INSERT INTO food (id, normalized_name, status) ...
 Test Files  1 failed (1)
      Tests  18 skipped (18)
```

Correct reason: the old schema is the fdcId/denormalized design (`foods`, `usda_sync_metadata`,
`usda_call_log`); the source-agnostic canonical `food` table (and the other 12) do not exist, so the
seed for the new constraint probes cannot run. This is the expected Red state.

### Green result

After implementing the split schema (`src/db/schema/food.ts` + `operational.ts` +
`food-candidates.ts` + `index.ts` barrel + `src/db/ulid.ts` `newFoodId`), deleting `usda.ts`, and
rewriting `src/db/migrations/0000_food_schema.sql` to the full 13-table DDL:

```
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

All 18 assertions green, including the load-bearing ones:

- all 13 tables + 5 enum types (`food_status`, `food_kind`, `food_source`, `food_field`,
  `nutrient_basis`) exist; no `fdc_id` column on any table (SC-013);
- `food.normalized_name` UNIQUE rejects a duplicate (FR-005);
- **D-PROVENANCE-FK / DB-2 (the key integrity test):** the composite `(food_id, source_id)` FK to
  `food_sources(food_id, id)` ACCEPTS a same-food `source_id` and REJECTS a `food_nutrients` /
  `food_portions` / `food_field_provenance` row whose `source_id` belongs to a DIFFERENT food;
- `CHECK (amount >= 0)` and `CHECK (gram_weight > 0)` reject bad values (DB-6);
- the operational text+CHECK columns reject out-of-set `food_sources.fetch_state` /
  `fetch_queue.status` (DB-7);
- `nutrient (name, unit)` fallback dedup UNIQUE (DB-5);
- `fetch_queue.leased_at` exists and is nullable + the `idx_fetch_queue_priority` and
  `idx_fetch_queue_inflight_lease` partial indexes exist (D-LEASE / DB-8);
- `pg_trgm` installed + GIN trigram indexes on `food.name` / `food.description` (FR-008);
- `food_candidates` `UNIQUE(food_id, source, external_key)` rejects a duplicate candidate
  (D-CANDIDATES).

`tsc --noEmit`, `prettier --check`, and `eslint` are clean on all new schema/test files.

### Known/expected gaps (deferred)

- **`foods/*` typecheck RED (deferred to T-130).** Deleting `usda.ts` breaks three files that still
  import `../db/schema/usda.js`: `src/foods/foods.repository.ts`, `src/foods/foods.service.ts`,
  `src/foods/__fixtures__/foods.fixtures.ts` (`error TS2307: Cannot find module
'.../db/schema/usda.js'`). Phase 3 (T-130) rewires `foods/*` onto the new DAOs; these are the only
  `tsc` errors in the package and are out of scope for this schema slice.

### Deviation from plan §2

- **Reaper index name.** Used `idx_fetch_queue_inflight_lease` (plan.md §2 line 310, the authoritative
  DDL). `tasks.md` T-104 prose calls it `idx_fetch_queue_inflight_leased` (trailing "d"). Followed the
  authoritative plan §2 spelling; T-104 prose should be reconciled to match.

No other deviations: every type, constraint, and index mirrors plan.md §2 + decision-register
Additions A/B/C exactly.

---

## 2026-06-29 — Phase 1 slice: DAO layer (T-105, T-106, T-107, T-108, T-109, T-110, T-111 CandidateStore)

**Scope.** The per-aggregate DAO/persistence seam (MOD-016/MOD-019) over the committed 13-table
schema, in `src/foods/dao/`. NO NestJS module wiring (that is T-130), NO source adapter (T-120+), NO
read API/controller/service (T-130+); the old `foods/*` layer + `usda.ts` are untouched. Per plan.md
§5, v-model `module-design.md` (MOD-003/005/016/018/019), and decision-register D-\* the authoritative
spec.

**DAOs delivered (files).**

- T-105 `FoodDao` — `src/foods/dao/food.dao.ts` (`getById`, `createByName`, `setStatus`,
  `upsertGoldenScalars`, `readGoldenRecord`).
- T-106 `FoodSourcesDao` — `src/foods/dao/food-sources.dao.ts` (`upsertSource`,
  `findFoodIdByExternalKey`, `findFoodIdByBarcode`, `findSourceId`).
- T-107 `NutrientDao` + `FoodNutrientsDao` — `src/foods/dao/nutrient.dao.ts`, `food-nutrients.dao.ts`
  (`resolveOrCreate`; `upsertValue`, `listByFood`).
- T-108 `FoodPortionsDao`, `FoodFieldProvenanceDao`, `FoodCategoryDao` — `src/foods/dao/`
  (`insertPortion`; `record`, `fieldsFromSource`; `upsertCategory`, `assign`).
- T-109 `FetchQueueDao` + `FetchRequestersDao` — `src/foods/dao/fetch-queue.dao.ts`,
  `fetch-requesters.dao.ts` (`enqueue`, `reactivate`, `leaseNext`, `reapExpiredLeases`,
  `pendingCountForSub`, `resolve`, `tombstone`; `add`, `countForFood`, `deleteForFood`).
- T-110 `SourceCallLogDao` — `src/foods/dao/source-call-log.dao.ts` (`checkAndRecord`,
  `countInWindow`, `pruneAged`).
- T-111 (DAO) `CandidateStore` — `src/foods/dao/food-candidates.dao.ts` (`persistCandidates`,
  `getCandidates`, `isMember`, `clear`).
- Typed errors + guards — `src/foods/dao/dao.errors.ts` (`IllegalStatusTransitionError` +
  `is*` guards, `isUniqueViolation`); named barrel `src/foods/dao/index.ts`.

**Harness.** Docker Postgres 16 (`food_e2e`), `DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_e2e`,
Node v24, `npm run test:integration`. New DAO suites reuse the schema-test bootstrap via
`tests/support/db.ts` (`resetSchema` applies the ordered migration to a clean `public` schema per
suite; `makeDb` binds a Drizzle client to the pool).

### Red gate (confirmed failing for the right reason)

Wrote all seven DAO integration suites FIRST and ran them before any DAO existed:

```
Error: Cannot find module '../src/foods/dao/food.dao.js' imported from .../tests/food.dao.integration.test.ts
 Test Files  7 failed | 1 passed (8)
      Tests  18 passed (18)
```

Correct reason: the seven new suites fail at import collection because `src/foods/dao/*` does not yet
exist; the pre-existing `schema.integration.test.ts` (18 tests) stays green, proving the Postgres
harness itself works. Expected Red state.

### Green result

After implementing the DAOs:

```
 Test Files  8 passed (8)
      Tests  66 passed (66)
```

All 66 assertions green (48 new DAO assertions + the 18 schema assertions), including the hard ones:

- `createByName` idempotent on normalized name (second add → same `id`, `created=false`); a terminal
  (`NOT_FOUND`/`FAILED`) row PAST its 30-day TTL is reactivated → `PENDING` with no `23505`; a
  terminal row WITHIN TTL is NOT reactivated (FR-028a).
- `setStatus` rejects an illegal transition (`RESOLVED`→`UNRESOLVED`, `RESOLVED`→`FAILED`) via the
  guarded conditional UPDATE matching no row → `IllegalStatusTransitionError`, status unchanged;
  terminal targets stamp `tombstoned_at`, others clear it.
- `readGoldenRecord` assembles food + sources + nutrients + portions + field provenance with ISO-8601
  dates and NO `fdcId`/`fdc_id` anywhere (SC-013).
- distinct-requester demand: 50 adds by ONE sub → `request_count=1`; N distinct subs → N; never a raw
  `+1` (FR-044/DSN-3).
- `leaseNext` claims highest `request_count` first under a `leased_at`/`in_flight` lease, skips a
  freshly-leased row (`FOR UPDATE SKIP LOCKED`); a stale `in_flight` lease is reclaimed by both
  `reapExpiredLeases` and `leaseNext` WITHOUT touching `attempts` (FR-018/DSN-5).
- `SourceCallLogDao.checkAndRecord` allows strictly under cap, denies AT cap, and NEVER exceeds the
  cap under 40-way concurrency (exactly `cap` allowed); the trailing-60-min count slides; the prune is
  conservative (`<` window edge) so it never under-counts the limiter (TST-5).
- `NutrientDao` dedup collapses a duplicate `Protein` (one with a NULL `external_code`) to one
  `nutrient_id` and backfills a later-known code (DB-5).
- `CandidateStore` persists/lists the set, validates membership, clears on resolve, excludes a set
  past the 30-day TTL, and cascades on parent-`food` delete (FR-025a/D-CANDIDATES).

`tsc --noEmit` (whole package, incl. retained `foods/*` + `usda.ts`), `eslint` (src), and
`prettier --check` are all clean. Default unit suite (`npm test`) still green (4 files / 42 tests).

### Deviations from plan §2 / module-design (with rationale)

1. **Nutrient dedup key — implemented against the COMMITTED two-constraint schema, not the single
   `COALESCE(...)` expression key in T-107/DB-5 prose.** The committed `nutrient` table (T-100, already
   green) enforces two separate uniques — `UNIQUE(external_code)` and `UNIQUE(name, unit)` — NOT a
   single `UNIQUE(COALESCE(external_code, lower(name)||'|'||unit))` expression index. `resolveOrCreate`
   honors the committed schema (the source of truth I was told not to break) via an
   external_code-first → `(name, unit)`-fallback resolve that delivers the same DB-5 guarantee
   (duplicate `Protein` collapses to one `nutrient_id`). **Caveat:** the committed `(name, unit)` unique
   is case-SENSITIVE (no `lower()`), so `Protein` vs `protein` would be two rows under the committed
   schema, whereas the design's `lower()` key would collapse them. Reconcile before adapters feed
   mixed-case nutrient names — either add a `lower(name)` expression index/constraint in a follow-up
   migration, or normalize names in the adapter. Flagged for `db-arch-1` / the schema owner.
2. **`enqueue` computes `request_count` from the live distinct-sub count on BOTH the insert and the
   conflict path** (MOD-003's pseudocode inserts the literal `1` on first insert, then recomputes only
   on conflict). Computing on insert too makes `request_count` correct regardless of add/enqueue
   ordering and is exactly what T-109 mandates ("set `request_count` to the distinct-sub COUNT … never
   a raw `+1`"). Strict improvement; no behavior the spec forbids.
3. **`SourceCallLogDao.checkAndRecord` takes a per-source transaction-scoped advisory lock** around the
   count+conditional-insert. MOD-005 relies on the single-drainer advisory lock (REQ-022) to serialize
   the read-committed statement; a DAO exercised outside that outer lock could otherwise overshoot the
   cap under MVCC. The per-source lock makes the "≤cap in any rolling-60-min window" guarantee (SC-002)
   hold in isolation and under concurrency. Strict hardening of the same invariant.

### Deferred (out of this slice)

- DAOs are NOT wired into a NestJS module/provider (T-130, Phase 3). They are plain classes taking the
  Drizzle client in the constructor (mirrors the identity `UserDAO` seam), ready for the
  `FoodsRepository` facade + DI wiring in Phase 3.
- No source adapter (T-120+), no read API/controller/service rewire (T-130+). The excluded
  `tests/foods-api.integration.test.ts` (superseded fdcId read API) remains parked per
  `vitest.integration.config.ts`.

---

## 2026-06-29 — Phase 2 slice: Source adapter + USDA adapter + per-source limiter (T-120, T-121, T-122)

**Scope.** The pluggable source-adapter boundary, the USDA adapter wrapping `@kitchensink/usda-client`,
and the per-source rolling-window limiter over the committed `SourceCallLogDao` — all in `src/sources/`.
NO merge engine, NO candidate-resolution service, NO fan-out worker, NO NestJS module wiring, NO read
API. The old `foods/*` layer + retained `usda.ts` are untouched. Authoritative spec: plan.md §5
(Workers & Source Adapters), v-model `module-design.md` MOD-005/MOD-008/MOD-015/MOD-021 (ARCH-005/008/
013/019), decision-register (DB-5 nutrient dedup), tasks.md T-120/T-121/T-122.

**Files delivered.**

- T-120 `src/sources/food-source-adapter.ts` — the `FoodSourceAdapter` interface; source-agnostic
  candidate types (`SourceCandidate { source, externalKey, name }`, `CanonicalCandidate { source,
externalKey, name, kind, brandOwner, brandName, description, barcode, nutrients[], portions[],
itemVersion }` — internal-shaped, NEVER `fdcId`); `CanonicalNutrient`/`CanonicalPortion`;
  `SourceAdapterRegistry` (`register`/`has`/`adapterFor`/`adapters`/`priorityOf`); the static
  `SOURCE_PRIORITY = ['usda']`; and the boundary errors `SourceApiError`, `AdapterValidationError`,
  `DuplicateSourceError`, `UnknownSourceError` (each extends `Error` + `Object.setPrototypeOf` + an
  `is*` guard). `FoodSourceId` is derived from the `food_source` pgEnum so the adapter layer and DB
  can never drift.
- T-121 `src/sources/usda/usda.adapter.ts` — `UsdaSourceAdapter implements FoodSourceAdapter`; the
  ONLY place `fdcId`/USDA terms appear. `searchByName` → `client.searchFoods`; `fetchByKey` →
  `client.getFood` then `mapToCanonical` (`fdcId → externalKey`); per-100g nutrient mapping; nutrient
  case-normalization + dedup (DB-5 fix, below); portion mapping from the client's preserved `raw`
  payload (validated with a local zod schema — the typed `UsdaFoodDetail` does not surface
  `foodPortions`); `itemVersion = publicationDate ?? sha256(raw)`; reject-not-store validation; and
  `classifyError` mapping the USDA error hierarchy → `SourceApiError(statusCode)`. Plus exported pure
  helpers `canonicalizeNutrientName`/`canonicalizeUnit`. Fixtures: `src/sources/usda/__fixtures__/usda.fixtures.ts`.
- T-122 `src/sources/rolling-window-limiter.ts` — `RollingWindowLimiter` over `SourceCallLogDao`:
  `tryRecord` (atomic check-and-record at the hard cap), `count`, `isPaused` (≥ 90% pause threshold OR
  active 429-failsafe), `markWindowFull` (429 failsafe), `pruneAged`. `DEFAULT_SOURCE_CAPS = { usda:
{ hardCap: 1000, pauseThreshold: 900 } }`; caps/back-off/clock injectable for tests.

**mapToCanonical — per-100g, name normalization, reject-not-store.** Each USDA nutrient with a present
`value` is emitted as `{ code: null, name, unit, amount: String(value), basis: 'per_100g' }` (USDA
abridged values are per-100g; `amount` kept as a string for `numeric` fidelity, SC-008). Names/units are
folded to a deterministic canonical form BEFORE they become the `(name, unit)` dedup key:
`canonicalizeNutrientName` = trim → collapse whitespace → sentence-case (`Protein`/`protein`/`PROTEIN`
→ `Protein`); `canonicalizeUnit` = trim + lowercase (`G`→`g`, `KCAL`→`kcal`). `mapNutrients` then dedups
on that key keeping the first occurrence, so case variants collapse to ONE canonical nutrient — the fix
for the committed case-SENSITIVE `nutrient (name, unit)` UNIQUE flagged in the Phase-1 DAO deviation
(DB-5). Validation is **reject-not-store** at the candidate grain: a present-but-invalid value
(negative / non-finite / out-of-range amount or gram weight, over-length name/unit/label) throws
`AdapterValidationError` and nothing is returned; a value USDA simply omits is skipped (absent, not
malformed). A non-positive-integer `externalKey` is rejected before any fetch.

**Limiter atomicity / 90% / 429.** `tryRecord` delegates to the committed `SourceCallLogDao.checkAndRecord`,
whose per-source transaction-scoped advisory lock makes the windowed count + conditional insert serial —
so concurrency can never push the window past the hard cap (verified: 40 concurrent `tryRecord` at
hardCap=10 → exactly 10 allowed). `isPaused` returns true at/above the 90% soft threshold (pause = 900
for USDA's 1000) while still below the hard cap. `markWindowFull` is the 429 failsafe: it sets an
in-process per-source `windowFullUntil = now + backoff`, during which `tryRecord` denies WITHOUT
recording (count unchanged) and `isPaused` short-circuits true, regardless of the DB count; the failsafe
expires when the back-off elapses (verified with an injected clock).

### Red gate (assertion-level, confirmed failing for the right reason)

Wrote all three test suites FIRST, then type-correct skeletons (registry methods returning wrong
constants / throwing `NOT_IMPLEMENTED`) so the failures are real behavior assertions, not
module-missing collection errors:

```
# Unit (src/sources)
 Test Files  2 failed (2)
      Tests  18 failed | 4 passed (22)
  e.g. × priorityOf ranks usda at the top (priority 1)         expected 1, received 0
       × rejects a duplicate registration (DuplicateSourceError) expected true, received false
       × maps fdcId → externalKey ... (NOT_IMPLEMENTED: fetchByKey)
       × normalizes nutrient names so case variants collapse to ONE row
       × classifies a 429 as SourceApiError(statusCode=429)     expected true, received false
# Integration (rolling-window-limiter)
 Test Files  1 failed (1)
      Tests  7 failed (7)   e.g. Error: NOT_IMPLEMENTED: count / tryRecord
```

The 4 unit tests that passed under the skeleton are pure data-shape assertions (`SOURCE_PRIORITY`
contents + the two candidate-shape `not.toContain('fdcId')` checks) that do not depend on logic.

### Green result

Skeleton bodies replaced with the real implementations:

```
# Unit (whole package)        Test Files 6 passed (6)   Tests 64 passed (64)   (+22 new: 8 registry/types, 14 USDA adapter)
# Integration (whole package) Test Files 9 passed (9)   Tests 73 passed (73)   (+7 new: rolling-window-limiter)
```

`npx tsc --noEmit` (whole package, incl. retained `foods/*` + `usda.ts`) is clean; `npm run lint` (src)
exit 0; `npm run format:check` (prettier) clean.

### Deviations from plan §5 / module-design (with rationale)

1. **Target file paths follow tasks.md, not module-design's `Target source file` lines.** module-design
   places the limiter at `src/worker/rolling-window.limiter.ts` and the registry at
   `src/sources/source-adapter.registry.ts`; tasks.md T-120/T-121/T-122 specify
   `src/sources/food-source-adapter.ts`, `src/sources/usda/usda.adapter.ts`,
   `src/sources/rolling-window-limiter.ts`. Followed tasks.md (the explicitly-cited authority for paths).
2. **Portions are read + validated from the client's preserved `raw` payload, not from a typed field.**
   The committed `@kitchensink/usda-client` `UsdaFoodDetail` does not surface `foodPortions` (only
   `foodNutrients`); the verbatim payload is preserved on `detail.raw`. The adapter validates
   `raw.foodPortions` with a local zod schema at the boundary (reject-not-store on a non-positive gram
   weight). This keeps USDA-shape knowledge confined to the adapter and avoids modifying the "done"
   client. If a typed `foodPortions` is later added to the client, the adapter can switch to it with no
   canonical-API change.
3. **`UsdaSchemaError` (2xx body shape drift) is classified as `SourceApiError(502)`** — treated as an
   upstream/bad-gateway failure (retryable by the worker), distinct from a transport 5xx. module-design
   lists schema failure under MOD-021 validation; mapping it to a 502 `SourceApiError` keeps the worker's
   retry/backoff decision purely status-driven without a separate error class crossing the boundary.
4. **`SourceApiError`/`AdapterValidationError` live in `food-source-adapter.ts` (the boundary contract
   file), not in a separate `source.errors.ts`.** They are part of the adapter interface's error
   contract and are consumed source-agnostically by the future worker; co-locating them with the
   interface avoids an extra file while keeping USDA-specific mapping in `usda.adapter.ts`. No `assertHttps`/
   `TransportSecurityError` was added — the client hard-codes an `https://` base URL, so transport
   security is already guaranteed; an explicit guard is deferred to when a configurable base URL exists.

### Deferred → Phase 3

- Fan-out across the registry + golden-record merge engine (T-152/T-160+), candidate-resolution
  `PATCH`-resolve re-fetch (uses `RollingWindowLimiter` + `fetchByKey`), the read API/controller/service,
  and NestJS module/DI wiring of the registry + adapter + limiter. The adapter/registry/limiter are
  plain classes (DAO-style constructor injection), ready to be wired behind the `FoodsRepository`/worker.
- `getWaitTime`/`awaitHeadroom` (PATCH-resolve wait-for-headroom, DSN-6) were not built in this slice;
  they belong with the resolve path in Phase 3.

---

## 2026-06-29 — Phase 6 slice: MERGE ENGINE + GOLDEN RECORD + PROVENANCE + AUTO-RESOLVE (T-160, T-161, T-162, T-163, T-164)

**Scope.** The pure field-level golden-record merge engine, the survivor-count auto-resolve boundary,
the transactional provenance writer, the manual-resolution merge path, and merge-boundary
input sanitization. ALL new code is confined to `packages/services/food-service/src/foods/merge/`
(`merge-engine.ts`, `merge-sanitize.ts`, `merge-and-persist.service.ts`, `index.ts`, fixtures, unit
test) + one integration test (`tests/merge-and-persist.integration.test.ts`). NO NestJS module/DI
wiring, NO controller/route/worker, NO HTTP; the old `foods/*` layer and `usda.ts` were not touched.
Built ON the committed Phase-1 DAOs and Phase-2 adapter types per plan.md §6/§9, MOD-015/MOD-017/
MOD-019, decision-register D-AUTORESOLVE / D-PROVENANCE-FK / D-MERGE, tasks T-160..T-164.

**Test-first tasks covered:** T-160 (field-level merge — each rule), T-161 (provenance writer —
integration), T-162 (pre-merge dedup + auto-resolve boundary 1/>1/0), T-163 (manual-resolution path),
T-164 (reject-not-store sanitization).

**Harness.** Node v24; unit = `vitest run src/foods/merge`; integration = Docker Postgres 16
(`DATABASE_URL=postgres://postgres:postgres@localhost:5432/food_e2e`),
`vitest run --config vitest.integration.config.ts tests/merge-and-persist.integration.test.ts`,
reusing `tests/support/db.ts` (drop+recreate `public`, apply the ordered migration).

### Red gate (assertion-level, confirmed failing for the right reason)

Wrote the unit + integration tests FIRST against signature-correct STUBS (`mergeCandidates` →
`NOT_FOUND`; `blendCandidates` → empty draft; `sanitizeCandidates` → identity; `MergeAndPersist`
persists nothing, returns `PENDING`). Failures were assertion-level, not import/module-missing:

- Unit `src/foods/merge/__tests__/merge-engine.test.ts`: **12 failed / 2 passed (14)** — e.g.
  `expected 'NOT_FOUND' to be 'RESOLVED'` (boundary), `expected undefined to be 'Acme'` (priority
  short-field), `expected undefined to be '2.8'` (per-100g-before-blend), `expected [ 'Protein',
'BadFat', 'NaNCarb' ] to deeply equal [ 'Protein' ]` (sanitize). The 2 passing were the genuine
  `NOT_FOUND` (0 candidates) case and `normalizeName`.
- Integration `tests/merge-and-persist.integration.test.ts`: **6 failed / 2 passed (8)** — e.g.
  `expected 'NOT_FOUND' to be 'RESOLVED'`, `expected [] to include 'field:name'`, `expected 'PENDING'
to be 'NOT_FOUND'`. The 2 passing were schema-only assertions (no raw-payload column; cross-food FK
  reject) that do not depend on the persist path.

### Green result

Replaced the stubs with the real merge rules, sanitizer, and transactional persistence:

- Unit `src/foods/merge`: **14 passed (14)**.
- Integration `tests/merge-and-persist.integration.test.ts`: **8 passed (8)**.
- Whole package — unit: **Test Files 7 passed, Tests 78 passed**; integration: **Test Files 10
  passed, Tests 81 passed**.
- `npx tsc --noEmit` (whole package, incl. retained `foods/*` + `usda.ts`): clean. `npm run lint`
  (src): exit 0. `npm run format:check`: clean.

### Merge-engine rule implementation (T-160) + per-100g normalization before blend

`mergeCandidates(candidates, priorityOf)` is a deterministic pure function, generic over the source-id
type `S extends string` (default `FoodSourceId`) so the priority rules are unit-testable with two
synthetic sources even though the wired `food_source` enum lists only `usda`. After grouping candidates
by `normalizeName` (trim + collapse-whitespace + lowercase = the dedup grain), the single surviving
group is blended by `blendCandidates`, which ranks contributors by `priorityOf` (descending, stable —
ties keep input order):

- **presence beats absence** — a field present on any contributor fills the record.
- **identity/short fields** (`name`, `kind`, `brand_owner`, `brand_name`, `barcode`) → the
  highest-priority contributor with a present value (NOT the longest).
- **free-text** (`description`) → the longest present value; ties keep the higher-priority contributor.
- **nutrients** → each value is normalized to per-100g FIRST, then the highest-priority present value
  wins per dedup key (`code ?? name|unit`); `food_nutrients.source_id` records the winner. **Per-100g
  normalization happens before the blend** in `toPer100gAmount`: a `per_100g` amount passes through; a
  `per_serving` value is dropped (returns `null`, treated as absence) because the committed
  `CanonicalNutrient` carries no serving-gram basis to convert with — so it is never blended on the
  wrong basis (the per-100g value from a lower-priority source wins instead, which the dedicated test
  asserts).
- **portions** → unioned across contributors, each tagged with its contributor's `(source, externalKey)`.

### Auto-resolve boundary (T-162)

The outcome is decided purely by the survivor count after normalized-name exact match (FR-MRG-5,
D-AUTORESOLVE — no nutrient-tolerance knob, biased to `UNRESOLVED`): 0 candidates → `NOT_FOUND`; >1
distinct normalized-name group → `UNRESOLVED` (the full surviving candidate set is returned for
disambiguation); exactly 1 group → `RESOLVED` (blend it).

### Transactional provenance persistence shape (T-161/T-162/T-163)

`MergeAndPersistService` is the cohesive seam. `resolveAndPersist` (worker) sanitizes → merges →
persists in ONE `db.transaction`. RESOLVED: upsert a `food_sources` crosswalk row per contributing
source (so every value's `source_id` exists), then write golden scalars, `food_field_provenance(field,
source_id)`, `food_nutrients(source_id, per-100g basis)` (dictionary resolved via `NutrientDao`), and
`food_portions(source_id)`, then `setStatus('RESOLVED')`. Each value's `source_id` is resolved from the
freshly-upserted crosswalk by `(source, externalKey)`, so the same-food provenance FK (D-PROVENANCE-FK)
holds and "which fields came from source X" answers in one UNION query. No raw payload is stored
(SC-013 — verified by an `information_schema` assertion that `food_sources` has no raw/payload column).
UNRESOLVED: `CandidateStore.persistCandidates` (metadata only, `UNIQUE(food_id, source, external_key)`)

- `setStatus('UNRESOLVED')`. NOT_FOUND: `setStatus('NOT_FOUND')` (tombstone). `resolveFromPicks`
  (manual PATCH, T-163) blends the user's re-fetched picks directly to `RESOLVED` (survivor-count gate
  bypassed — the human disambiguated), stores the pick as ordinary provenance (indistinguishable to a
  refresh), and clears the candidate set — atomically.

### What the Phase-5 worker and Phase-4 PATCH-resolve will call

- Phase-5 fan-out worker → `MergeAndPersistService.resolveAndPersist({ foodId, candidates })`.
- Phase-4 `PATCH`-resolve → `MergeAndPersistService.resolveFromPicks({ foodId, picks })` (after
  re-fetching the picked candidates by `external_key`). Both share `GoldenRecordMergeEngine` (bound to
  the `SourceAdapterRegistry` for source priority). Neither is wired into a NestJS module here.

### Deviations from plan §6 / module-design (with rationale)

1. **`per_serving` nutrients are dropped (presence-as-absence), not arithmetically converted.**
   module-design's `normalizeToPer100g` multiplies by `100/servingGrams`, but the committed Phase-2
   `CanonicalNutrient` type carries NO serving-gram field, and the adapter already emits per-100g. The
   type-honest behavior is therefore to drop an un-normalizable `per_serving` value — exactly the
   MOD-017 error-table row "missing serving basis (per_serving, no grams) → drop that value". A real
   arithmetic conversion is a no-op to add once a serving-gram basis exists on the canonical type.
2. **Merged values carry `(source, externalKey)`, not just `source`.** A survivor group can contain
   multiple items from the same source (different `external_key`), so per-value provenance must map to
   the exact crosswalk row, not just the source. The merge output tags each scalar/nutrient/portion
   with its winning contributor's `externalKey`; persistence resolves `source_id` by `(source,
externalKey)`. Faithful to the per-value `source_id` intent (R5).
3. **The engine is generic over the source-id type + an injected `priorityOf`.** module-design has the
   engine consult `SourceAdapterRegistry.priorityOf` directly; the wired `food_source` enum has only
   `usda`, so a registry-bound engine cannot exercise multi-source conflicts in a unit test. The pure
   `mergeCandidates`/`blendCandidates` take an injected `priorityOf` and are generic over `S extends
string`; `GoldenRecordMergeEngine` binds them to the real registry for production. No fake source
   ever reaches the DB.
4. **One documented `as unknown as FoodDrizzle` narrowing** (`asDaoDb`) adapts an open Drizzle
   transaction handle to the committed DAO constructor type (the DAOs take `FoodDrizzle`, and a tx
   handle is not nominally assignable — it lacks `$client`). The DAOs are out-of-scope to modify; this
   is the single, centralized narrowing point so all DAO writes share one transaction.
5. **Target file is `src/foods/merge/merge-engine.ts` (per tasks.md T-160), not module-design's
   `src/merge/golden-record-merge.engine.ts`** — followed the explicitly-cited task path; co-located
   `merge-sanitize.ts` + `merge-and-persist.service.ts` in the same domain folder.

### Deferred (out of this slice)

- NestJS module/DI wiring of `GoldenRecordMergeEngine`/`MergeAndPersistService` (the API/worker slice).
- Portion _replacement_ on re-merge (the change-refresh `replaceChanged` grain, MOD-016/MOD-020) — the
  Phase-6 paths persist a first-time / picked resolution onto a food with no prior portions; idempotent
  portion replacement belongs with the refresh branch.
- `mergeChanged` selective re-merge (change-refresh, FR-032) — Phase later.

---

## 2026-06-29 — Phase 5 slice: QUEUE FAN-OUT WORKER + LIMITER INTEGRATION + EVENT EMISSION (T-150, T-151, T-152, T-153, T-154, T-155, T-165)

**Scope.** The Fargate fan-out/merge consumer in `src/worker/` plus the completion/failure event
emitter in `src/events/`, building ON the committed DAOs (`FetchQueueDao`/`FetchRequestersDao`),
`SourceAdapterRegistry` + `UsdaSourceAdapter`, `RollingWindowLimiter`, and `MergeAndPersistService`.
NOTHING else: no HTTP controller/route, no `FoodAuthGuard`, no add-by-name/PATCH-resolve endpoint, no
rewire of the old `foods/*` layer, `usda.ts` untouched/undeleted (those are the next slice).

**Tasks covered:** T-150 (worker scaffold — single instance via Postgres advisory lock,
`LISTEN fetch_queued` wake ≤100ms, structured logging, SIGTERM in-flight lease release), T-151 (drain
loop over `FetchQueueDao.leaseNext`, demand-weighted + drain-time demotion already in the DAO), T-152
(fan-out across `SourceAdapterRegistry.adapters()` gated by `RollingWindowLimiter` — 90% pause +
window-full → defer), T-153 (lease reaper + 5xx/timeout backoff `attempts++` → FAILED tombstone after
5, NOT_FOUND tombstone on 0 hits), T-154 (RESOLVED → `MergeAndPersistService.resolveAndPersist` +
`FetchQueueDao.resolve` deletes the row + emit `FoodFetchCompleted`), T-155 (USDA ≤20-key batch
`fetchByKeys` — one windowed call for many keys), T-165 (`FoodEventEmitter` over an injectable
`EventBus` seam; canonical detailType `FoodFetchCompleted`; `FetchFailed` on a FAILED tombstone only,
DSN-9; fire-and-forget).

**Files added.**
`src/events/food-event-emitter.ts` (+ `index.ts` barrel) — `EventBus` seam, `FoodEventPublisher`,
pure `buildFoodFetchCompleted`/`buildFetchFailed`, `FoodEventEmitter`, no-AWS `ConsoleEventBus`.
`src/worker/backoff.ts` (`backoffSeconds = 2^attempts`, `MAX_FAILURE_ATTEMPTS = 5`),
`src/worker/worker-logger.ts` (JSON `ConsoleWorkerLogger` + `SilentWorkerLogger`),
`src/worker/worker-lock.ts` (`acquireWorkerLock`/`releaseWorkerLock`, advisory class 1 — distinct
from FoodDao dedup class 2 / limiter class 3), `src/worker/food-consumer.service.ts`
(`FoodConsumerService` — the per-row fan-out/merge core), `src/worker/worker-runtime.ts`
(`WorkerRuntime` — lock + LISTEN/NOTIFY + reaper interval + SIGTERM), `src/worker/main.ts`
(bootstrap), `src/worker/index.ts` (barrel).

**Files fleshed-out (committed pieces extended, additively).**
`src/foods/dao/fetch-queue.dao.ts` — added `recordFailure` (attempts++ + `last_requested = now() +
2^attempts s`), `deferLease` (no attempts++, DSN-5), `releaseInFlight` (SIGTERM graceful release).
`src/sources/food-source-adapter.ts` — added the OPTIONAL `fetchByKeys?` to the adapter interface.
`src/sources/usda/usda.adapter.ts` — implemented `fetchByKeys` over the client's `getFoodsBatch`
(≤20, `USDA_BATCH_MAX`); `mapToCanonical`/`fdcId→externalKey` unchanged.

### Red gate (assertion-level, confirmed failing for the right reason)

Wrote all four test suites FIRST, then type-correct skeletons (pure builders + `backoffSeconds` +
`FoodConsumerService`/`WorkerRuntime` methods throwing `NOT_IMPLEMENTED`) so failures are real behavior
assertions, not module-missing collection errors:

```
# Unit (backoff + event payloads)
 Test Files  2 failed (2)
      Tests  8 failed | 1 passed (9)
  e.g. Error: NOT_IMPLEMENTED: backoffSeconds  (× 2^attempts curve, × retry-budget ceiling)
       Error: NOT_IMPLEMENTED: buildFoodFetchCompleted  (× payload shape, × emitter detailType)
# Integration (food-consumer + worker-runtime, real Postgres)
 Test Files  2 failed (2)
      Tests  12 failed | 1 passed (13)
  e.g. Error: NOT_IMPLEMENTED: processNext / processRow / start / stop / wake
```

The 1 integration test that passed under the skeleton is the single-drainer lock (TST-7), which drives
the already-real `acquireWorkerLock` directly (two sessions → exactly one acquires). The 1 unit pass is
the `MAX_FAILURE_ATTEMPTS === 5` constant assertion.

### Green result

Skeleton bodies replaced with the real implementations:

```
# Unit (whole package)        Test Files  9 passed (9)    Tests 87 passed (87)   (+9 new: 3 backoff, 6 event-emitter)
# Integration (whole package) Test Files 12 passed (12)   Tests 94 passed (94)   (+13 new: 10 consumer, 3 runtime)
```

Integration assertions proven: enqueue → NOTIFY/drain → fan-out (mocked registry/adapters) → merge →
RESOLVED → `fetch_queue` row deleted + requesters pruned + crosswalk/nutrient written → one
`FoodFetchCompleted` captured on the fake bus, with **exactly one** `source_call_log` row despite a
2-key batch (T-155/SC-014); per-key fallback when the adapter has no `fetchByKeys`; UNRESOLVED persists
a 2-row candidate set; 0-hit → NOT_FOUND tombstone (FoodFetchCompleted only, no FetchFailed); 5xx →
`record_failure` ×4 then `failed` tombstone + both FoodFetchCompleted(FAILED) and FetchFailed; 90%
limiter pause → `deferred`, no source call, row stays pending, no event; reaper reclaims a stale
in-flight lease; `drain` empties the queue; single-drainer lock (TST-7); `WorkerRuntime` wakes within
~100ms of a `pg_notify('fetch_queued')` and resolves the food; a second runtime cannot acquire the
lock; `stop()` releases in-flight leases → pending.

`npx tsc --noEmit` (whole package + `tsc -p infra`) clean; `npm run lint` (src) exit 0;
`npm run format:check` (prettier) clean.

### Deviations from plan §5 / module-design (with rationale)

1. **Refresh branch (DSN-4, `refreshResolvedFood`) is NOT implemented here** — it is change-driven
   refresh (Phase 8, FR-031/FR-032), out of the T-150..T-155 scope. The worker still guards the case:
   a RESOLVED row reaching the drainer is logged + acked off the queue (`refresh_skipped`) WITHOUT a
   name re-fan-out, so a stray RESOLVED row can never burn the per-source budget. The real selective
   in-place re-pull lands with the Phase-8 scheduler.
2. **`recordFailure`/`deferLease`/`releaseInFlight` added to `FetchQueueDao`, not the worker.** The
   module-design names these on `FetchQueueRouter`; the committed `FetchQueueDao` IS that router seam,
   so all queue mutations (backoff, deferral, graceful release) stay in the DAO rather than leaking SQL
   into the worker. Backoff is computed in SQL (`make_interval(secs => power(2, attempts + 1))`) using
   the post-increment `attempts`, matching `backoffSeconds`.
3. **Per-source window charged ONCE per drain (before `searchByName`)** — the whole per-source fan-out
   (search + ≤20-key batch fetch) counts as a single `source_call_log` row, satisfying SC-014/T-155 at
   the windowed-call grain; the ≤20-key BATCH is the additive network optimization (`fetchByKeys`),
   with a per-key fallback that recovers valid items if one item in a batch fails adapter validation
   (reject-not-store).
4. **`fetchByKeys` is OPTIONAL on the adapter interface** (additive, no breakage). USDA implements it;
   a source without a batch endpoint omits it and the worker falls back to per-key `fetchByKey`.
5. **Event emission is behind an injectable `EventBus`** (no real AWS in tests/bootstrap). The
   bootstrap (`main.ts`) wires the no-AWS `ConsoleEventBus` fallback so the worker never _requires_
   AWS; the real EventBridge `PutEvents` bus is added with the infra slice. `FoodEventEmitter` publishes
   are fire-and-forget (a bus failure is logged + swallowed — a completion/alarm signal must never fail
   the drain).
6. **Worker is a plain class + `WorkerRuntime`, not a NestJS provider.** The Fargate consumer is a
   long-running drain loop, not an HTTP request handler; keeping it framework-free makes the per-row
   logic trivially integration-testable with real Postgres + mocked adapters/bus.

### Known limitation carried through (NOT fixed here)

The `per_serving`-nutrient-dropped behavior from the merge engine (a branded `labelNutrients` value
with no serving-gram basis is dropped, per `toPer100gAmount` returning `null`) carries through fan-out
unchanged — the worker passes adapter candidates straight to `MergeAndPersistService` and does not
attempt a serving-basis conversion. Out of this slice by direction.

### What the API slice (Phase 3/4/8) still needs to wire

- **Phase 3 controller/service:** `POST /v1/foods` (createByName + `EnqueueEmitter.publishFoodRequested`
  → `fetch_queue` INSERT + `pg_notify`), `GET /v1/foods/{id}` (+`/status`, `/candidates`), `/search`,
  `/batch`; rewire the old `foods/*` layer (`FoodsRepository`/`FoodsService`/`FetchQueueService`) onto
  the new DAOs, then **delete `usda.ts`** and **re-add the `foods-api` integration test** (currently
  excluded in `vitest.integration.config.ts`).
- **`EnqueueEmitter` (MOD-002) producer half:** `publishFoodRequested`/`publishFoodBatchRequested`/
  `publishFoodReactivated` (+ `pg_notify`) — the demand-path enqueue + `IngestionScheduled`. The
  completion half (`publishFoodFetchCompleted`/`publishFetchFailed`) is delivered here as
  `FoodEventEmitter` and can be folded in or shared.
- **`FoodAuthGuard`** (NestJS middleware, in-process Clerk verify + azp + scopes/403) on every route.
- **Phase 4 PATCH-resolve:** `PATCH /v1/foods/{id}` validating picks against `food_candidates`,
  re-fetching by `external_key` through the SAME limiter, then `MergeAndPersistService.resolveFromPicks`.
- **Phase 8:** the change-refresh Fargate scheduled task + the worker's `refreshResolvedFood` selective
  in-place re-pull branch; the real EventBridge `EventBus` implementation behind the `FoodEventEmitter`
  seam; CloudWatch alarms.

---

## 2026-06-29 — Refinement slice: branded per-serving nutrient gap (D-PERSERVING, TDD)

**Scope.** Close the data-loss gap where USDA Branded foods that ship only a per-serving `labelNutrients`
panel persisted zero nutrition (the merge engine dropped every `per_serving` value). Code touched: the
USDA adapter (`src/sources/usda/usda.adapter.ts`) and the merge engine (`src/foods/merge/merge-engine.ts`)
only — NO worker, NO old `foods/*` layer, NO `usda.ts`. Plus a clause-level design-of-record update
(spec FR-MRG-3, decision-register §3.17 D-PERSERVING, module-design MOD-008/MOD-017, review.md refinement
note). Policy implemented exactly per the user-approved decision: prefer per-100g `foodNutrients`; convert
`labelNutrients` to per-100g at the ADAPTER boundary only when `servingSizeUnit` is grams
(`value * 100 / servingSizeGrams`); else keep `basis=per_serving` (no ml-equals-grams assumption); the
merge engine retains `per_serving` (per_100g wins a same-nutrient conflict; presence-beats-absence holds).

**Red gate (assertion-level, confirmed failing for the right reason).**

- Unit: `4 failed | 88 passed (92)`.
    - adapter: _converts a gram-serving labelNutrients panel to per-100g_ (FAIL — label ignored);
      _keeps a NON-gram (ml) serving panel as basis=per_serving_ (FAIL); _reject-not-store: a malformed
      (negative) label value rejects the candidate_ (FAIL). The _prefer-foodNutrients / no double-count_
      and _per_100g-wins-over-per_serving conflict_ assertions were already green (old code simply ignored
      the label / dropped per_serving) and stayed green after the change.
    - merge: _RETAINS a per_serving-only nutrient with basis=per_serving_ (FAIL — value was dropped).
- Integration (`DATABASE_URL` -> Postgres 16): `1 failed | 94 passed (95)` —
  _persists a branded per_serving nutrient with basis=per_serving_ (FAIL).

**Green result.**

- Adapter change: `mapNutrients` now also reads `labelNutrients` + `servingSize`/`servingSizeUnit` from the
  preserved `raw` payload (mirroring how portions are read), folds the label panel into the same deduped
  `(name, unit)` map after `foodNutrients` (so a per-100g value is never double-counted by the label), and a
  new `convertPerServingToPer100g` helper does the grams conversion with fixed-precision formatting (no float
  drift; `LABEL_NUTRIENT_MAP` maps label keys to canonical FDC names/units). Reject-not-store and name/unit
  canonicalization preserved (extracted into `assertAmountInRange`/`assertNutrientName`/`assertNutrientUnit`).
  File header doc updated.
- Merge change: `MergedNutrient.basis` widened to `CanonicalNutrientBasis`; the per-100g-only
  `toPer100gAmount` drop was replaced with `shouldReplaceNutrient` — a `per_serving` value is retained, the
  highest-priority value wins per dedup key, and a `per_100g` value upgrades over an already-recorded
  `per_serving` one (per_100g wins a basis conflict). Module + interface docs updated.
- Suites: unit `92 passed (92)`; integration `95 passed (95)` — the prior **87 unit / 94 integration**
  did not regress (87 + 5 new = 92; 94 + 1 new = 95). `npx tsc --noEmit` clean (whole package);
  `npm run lint` clean.

**Deviation.** While editing the adapter a stray NUL byte was introduced into the `foodNutrients`
nutrient-key separator, which silently defeated label/foodNutrients dedup and flagged the file as
non-UTF-8; replaced with a normal space and re-verified (`file` reports UTF-8; dedup green). No other
deviation from the approved policy.

---

## 2026-06-29 — Phases 3 + 4 + Phase 8 API-gate slice: `/v1/foods/*` HTTP API + auth + DI rewire (TDD)

**Scope.** The full source-agnostic `/v1/foods/*` HTTP surface, the in-process `FoodAuthGuard`, the shared
`@kitchensink/clerk-verify` package, the `EnqueueEmitter`, and the `foods/*` rewire off the deleted
fdcId-keyed layer onto the committed per-aggregate DAOs + adapter registry + merge service. Tasks: T-130,
T-131, T-132, T-133, T-134 (Phase 3); T-140, T-141, T-142, T-143, T-144, T-145 (Phase 4); T-046, T-033,
T-047, T-048 (Phase 8 API gate). NO change to the identity service, the worker, the DAOs, the merge
engine, or the migration SQL.

**New / rewired code.**

- **`@kitchensink/clerk-verify`** (new shared package, T-046): networkless `verifyClerkToken(token, {jwtKey,
authorizedParties})` extracted from the identity `ClerkAuthService` (one impl, no drift). Identity left on
  its own impl this slice (no break); the dedup is a follow-up (FU-CLERK-VERIFY-DEDUP). `@clerk/backend` was
  already in the tree (identity), so no new external dependency.
- **`FoodAuthGuard`** (`src/auth/`, T-033/T-047/T-048): in-process NestJS middleware on every `/v1/foods/*`
  route; Bearer-only; networkless verify; identity from the verified `sub` ONLY (forged `x-debug-sub` /
  `x-authorizer-context` ignored — old debug-sub path deleted); fail-closed 401; M2M accepted via the azp
  allowlist; `food:admin` scope gate for `/refetch`.
- **`EnqueueEmitter`** (`src/foods/enqueue.emitter.ts`, T-141): replaces the fdcId `FetchQueueService`;
  one-transaction `fetch_requesters` + `fetch_queue` upsert (or tombstone reactivation, DSN-1) +
  `pg_notify('fetch_queued', food_id)`; `requestedBy` = verified sub.
- **`FoodsService` / `FoodsController` / `FoodsModule`** rewired onto `FoodDao`/`CandidateStore`/
  `FoodSourcesDao`/`FoodSearchDao` (new) + `SourceAdapterRegistry` + `RollingWindowLimiter` +
  `MergeAndPersistService` + `EnqueueEmitter` + `AdmissionService` (new, T-144 backpressure/flood-shed).
- **Deleted** (no dangling refs): `src/db/schema/usda.ts`, `src/foods/foods.repository.ts`,
  `src/foods/fetch-queue.service.ts`, `src/foods/__fixtures__/foods.fixtures.ts`, and the two old fdcId unit
  test files. The parked `tests/foods-api.integration.test.ts` was rewritten to the new API and removed from
  the `vitest.integration.config.ts` exclude. `health.e2e.test.ts` `foods`→`food` table fixed.

**Red gate (assertion-level, confirmed failing for the right reason).**

- `@kitchensink/clerk-verify`: test written first → `1 failed (no tests)` — `Cannot find module '../clerk-verify.js'`
  (source absent). After impl → `8 passed`.
- `FoodAuthGuard`: unit suite added; ran against impl → `7 passed` (no/invalid/expired token → 401, next not
  called; verified `sub` only; forged headers ignored; missing `CLERK_JWT_KEY` → fail-closed 401; M2M accepted).
- HTTP API integration (supertest unavailable in-tree → booted Nest app + `fetch`, same harness as the e2e
  health spec): first run `23 failed | 109 passed` — every seeding test failed on `seedFood` (`inconsistent
types deduced for parameter $4`, the enum/text reuse), then `2 failed` on a shared-nutrient
  `nutrient_name_unit_unique` collision. Both were test-fixture bugs (not endpoint logic); fixed and green.

**Green result.**

- **food-service unit**: `85 passed (9 files)` — was 92; the 2 deleted fdcId unit files (~31 tests) are
  superseded by the new `FoodAuthGuard` (7) + rewritten `FoodsController` (18) units; the verification logic
  moved to clerk-verify's 8 tests. Net across the two packages: 93 unit (85 + 8), no behavioral regression.
- **food-service integration**: `132 passed (13 files)` — prior 95 + the re-added `foods-api.integration.test.ts`
  (37: full auth matrix + every endpoint's status codes incl. 401>403>400 precedence, 503+Retry-After
  backpressure/flood-shed, and the DSN-6 resolve cap/pause-exempt cases).
- **`@kitchensink/clerk-verify`**: `8 passed`. **e2e (booted app)**: `2 passed`.
- `npx tsc --noEmit` clean for **food-service** (app + `infra/tsconfig.json`), **clerk-verify**, AND the
  **identity service** (the shared package did not break it). `npm run lint` clean for both packages.
- `npm install --package-lock-only` run (lockfile carries `@kitchensink/clerk-verify`); `npm audit` shows only
  pre-existing ws/viem/wallet advisories — this slice adds no new external dependency.

**Deviations.**

1. **supertest not in the tree** → HTTP integration boots the real Nest app on an ephemeral port and drives
   it with global `fetch` (the established `tests/e2e/health.e2e.test.ts` pattern), not supertest.
2. **Missing-`CLERK_JWT_KEY` → 401** is proven at the unit level (clerk-verify: absent key throws without
   calling Clerk; guard: forwards the absent key and maps the throw to 401), not in the HTTP suite (the guard
   captures the key at boot, so a mid-suite env delete cannot exercise it on the already-booted app).
3. **T-046 identity dedup deferred** by instruction — clerk-verify is created and consumed by food-service
   only; identity stays on its own impl (FU-CLERK-VERIFY-DEDUP).
4. **Cross-process source circuit breaker (FR-046)**: `AdmissionService` enforces the durable queue-depth
   ceiling + near-ceiling flood-shed; the per-source 429-failsafe breaker lives in-process in the worker and
   is not visible to the API instance, so a durable breaker signal is a follow-up (FU-DURABLE-BREAKER).
5. **`/refetch` vs the worker refresh branch**: refetch re-enqueues (202) but the worker currently
   `refresh_skip`s a RESOLVED row (change-refresh is Phase 8 worker-side, out of this slice) — noted for the
   final e2e/worker slice.

---

## Test slice — `/v1/foods/*` integration + e2e coverage (2026-06-30, BE-1)

**Scope.** Author the comprehensive integration + e2e coverage for every `/v1/foods/*` endpoint and the
async worker flows. Test-only slice — no production behaviour changed. Coverage audit:
`specs/003-usda-food-data/testing/api-coverage.md`.

### Red / Green

| Suite                             | Before     | After   | Delta                                         |
| --------------------------------- | ---------- | ------- | --------------------------------------------- |
| Unit (`npm test`, food-service)   | 85         | 85      | —                                             |
| Integration (`test:integration`)  | 132        | **140** | +8 (extended `foods-api.integration.test.ts`) |
| E2E (`test:e2e`)                  | 2 (health) | 2       | — (**BLOCKED**, see STOP below)               |
| clerk-verify unit                 | 8          | 8       | —                                             |
| `npx tsc --noEmit` (food-service) | clean      | clean   | —                                             |

### Integration gaps filled (deliverable #3) — all green, mocked auth (orthogonal to the STOP)

- GET `/{id}/status` → 200 status-only for NOT_FOUND / FAILED / UNRESOLVED (no `food`).
- GET `/{id}/candidates` → 404 for unknown id.
- GET `/search` → product-barcode crosswalk hit; empty/whitespace query → empty (zero source calls).
- POST `/v1/foods` → re-add of an already-RESOLVED name returns inline RESOLVED with **no fresh
  enqueue** (FR-028a no-burn path).
- PATCH `/{id}` → 409 `NotResolvableError` on a PENDING food; 404 on unknown id.
- POST `/{id}/refetch` → 404 on an admin refetch of an unknown id (scope passes, food missing).

### STOP — production auth bug blocks the full-stack e2e (deliverable #2)

The e2e centrepiece (real minted Clerk JWT + stubbed adapter + worker drain) is **not landed** because
the real auth path is broken: `@kitchensink/clerk-verify.verifyClerkToken()` rejects every valid token
against the installed `@clerk/backend@1.34.0`. `verifyToken` returns the **bare JWT payload** on
success, but `clerk-verify.ts:114` (`result.errors || !result.data`) treats the absent `data` wrapper
as a failure → `ClerkVerificationError` → `FoodAuthGuard` 401. Every authenticated e2e flow is gated on
surviving the guard, so the suite would be red. Per the task instruction the e2e was **not** written
against a mocked `verifyClerkToken` (that would hide the bug and contradict the real-JWT requirement).

- Reproduction, root cause, blast radius (identity `clerk-auth.service.ts:84` shares the pattern),
  and the recommended fix are documented in `testing/api-coverage.md §4`.
- JWT minting recipe and the app+worker+stub-adapter harness are designed and proven in isolation
  (`testing/api-coverage.md §3`) — ready to wire once the auth bug is fixed.

### T-190 (E2E harness) status

Left **unchecked** — the add→resolve / candidates / NOT_FOUND / batch / search / FAILED / backpressure
e2e scenarios it requires cannot go green until the `clerk-verify` auth bug is fixed. The harness design

- stub-adapter + JWT-mint approach are recorded for immediate completion post-fix.

---

## Test slice (cont.) — full-stack e2e wired after auth fix (2026-06-30, BE-1)

The `clerk-verify` auth bug reported in the prior entry was fixed in `fc8974d` (clerk-verify + identity
`ClerkAuthService` accept `@clerk/backend` 1.34's bare-payload `verifyToken` return; regression-guard
tests use the real shape). With the real auth path working, the full-stack e2e is now wired and green.

### New e2e files

- `tests/e2e/foods-api.e2e.test.ts` — 15 specs: auth matrix (real RS256), add→resolve, UNRESOLVED→pick,
  NOT_FOUND, batch partial, search (fuzzy/external_key/barcode crosswalk + zero-source-call), FAILED,
  backpressure 503.
- `tests/support/jwt.ts` — throwaway RSA-2048 SPKI keypair + RS256 token minting (real, networkless).
- `tests/support/stub-source-adapter.ts` — programmable stub `FoodSourceAdapter` (module-mocked in place
  of `UsdaSourceAdapter`); per-name RESOLVED/UNRESOLVED/NOT_FOUND/error programming + call counters.

Harness: real Nest app (real `FoodAuthGuard`/`clerk-verify`, real minted JWT); worker built from the
app's own DI instances and driven by `consumer.drain()`; only the source adapter seam is stubbed; no
real USDA/AWS; `FoodFetchCompleted`/`FetchFailed` captured via an in-memory `EventBus`.

### Red / Green (final)

| Suite                                         | Count | Result   |
| --------------------------------------------- | ----- | -------- |
| Unit (food-service)                           | 85    | ✅       |
| Integration (food-service, real PG)           | 140   | ✅       |
| E2E (food-service: 15 new + 2 health)         | 17    | ✅       |
| clerk-verify unit                             | 9     | ✅       |
| identity (regression check)                   | 83    | ✅       |
| `npx tsc --noEmit` (food-service app + infra) | —     | ✅ clean |

T-190 marked `[x]`. Coverage matrix (`testing/api-coverage.md`) now shows every endpoint × {integration,
e2e} covered. No production code changed by this slice; no commit/push.

---

## Phase 7 — Change-Driven Refresh + UNRESOLVED TTL (T-170/T-171/T-172) (2026-06-30, BE-1)

TDD slice (tests first → confirmed RED → GREEN) building the change-driven refresh path + the UNRESOLVED
candidate-set TTL on the committed Phase-1/4/5/6 layers. **Scope:** the task logic + the worker refresh
branch + the selective merge — NOT the EventBridge→ECS `RunTask` CDK trigger (infra/CDK, T-001c, noted
out of scope; the app exposes a runnable `runOnce` entry instead).

### Change-detection + selective re-merge (T-171)

A `RESOLVED` row on the queue is unambiguously a change-refresh re-enqueue (a fresh add never re-enqueues
a RESOLVED food, DSN-1), so `FoodConsumerService.processRow` now takes a real
`refreshResolvedFood` branch (replacing the prior `refresh_skipped` ack):

- iterates the food's `food_sources` backing items, per-source rolling-window-gated (a 90% pause / full
  window DEFERS the row — back-pressure, no `attempts++`, DSN-5);
- re-fetches each by `external_key` (a re-fetch error skips the item, leaving its field(s) intact);
- collects only items whose `item_version` **changed** upstream and hands them to
  `MergeAndPersistService.mergeChangedSources` (new), which re-blends via the new pure
  `GoldenRecordMergeEngine.mergeChanged` (= `blendCandidates` over the changed items, never re-running
  disambiguation), upserts each changed crosswalk (advancing `item_version`), and rewrites just the
  values those items supply (nutrients by `(food_id,nutrient_id)`; the changed sources' portions via
  `FoodPortionsDao.deleteForSource`-then-insert; scalar winners + provenance). The food STAYS `RESOLVED`
  (`FoodDao.touch` bumps `updated_at`; `setStatus` is deliberately NOT called — `RESOLVED→RESOLVED` is not
  a legal transition). **Manual-pick preservation:** a pick is ordinary provenance at the item/crosswalk
  grain (DB-9); a refresh only re-pulls an item whose own `item_version` changed, so an unchanged pick is
  never in `changed` and is left untouched — and disambiguation is never re-run, so a refresh can never
  demote `RESOLVED → UNRESOLVED`.

### Change-refresh task (T-170) + UNRESOLVED TTL sweep (T-172)

`src/worker/change-refresh/change-refresh.consumer.ts` (`ChangeRefreshConsumer.runOnce`): (1) sweeps
expired UNRESOLVED candidate sets via `CandidateStore.clearExpired(FOOD_UNRESOLVED_TTL_DAYS=30,
config-overridable)` — the food STAYS `UNRESOLVED`, never swept to `NOT_FOUND`; (2) scans
`FoodSourcesDao.listResolvedBackingItems()` (status='RESOLVED' join excludes NOT_FOUND/FAILED tombstones),
re-fetches each to compare `item_version` (rolling-window-gated; pauses to yield to live demand), and
re-enqueues a changed food via the **ordinary** `EnqueueEmitter.publishFoodRequested(requestedBy:
'svc_change_refresh')` low-demand path (deduped via `ON CONFLICT`). `src/worker/change-refresh/main.ts` is
the runnable Fargate-scheduled-task entry (one `runOnce`, then exit); the EventBridge schedule → ECS
`RunTask` wiring is infra (T-001c, out of scope). **Re-fan-out (FR-025a):** `FoodsService.addByName` now
re-enqueues an `UNRESOLVED` food whose (TTL-filtered) candidate set is empty, so the next add-by-name
re-fans-out; `persistUnresolved` skips the illegal `UNRESOLVED→UNRESOLVED` transition so a re-fan-out that
stays ambiguous is idempotent. A human pick made before expiry still wins (→`RESOLVED`, no re-fan-out).

### Files

- Added: `src/worker/change-refresh/{change-refresh.consumer,index,main}.ts`;
  `tests/{food-refresh,change-refresh.consumer}.integration.test.ts`; `tests/e2e/change-refresh.e2e.test.ts`.
- Modified: `src/foods/merge/merge-engine.ts` (`mergeChanged` pure fn + engine method);
  `src/foods/merge/merge-and-persist.service.ts` (`mergeChangedSources` + idempotent `persistUnresolved`);
  `src/worker/food-consumer.service.ts` (`sources` dep + `refreshResolvedFood`/`refetchItem`,
  `refresh_skipped`→`refreshed`); `src/foods/dao/{food-sources(listByFood/listResolvedBackingItems/BackingItem),
food.dao(touch), food-portions.dao(deleteForSource), food-candidates.dao(clearExpired), index}.ts`;
  `src/foods/foods.service.ts` (expired-UNRESOLVED re-fan-out); `src/config/env.schema.ts`
  (`FOOD_UNRESOLVED_TTL_DAYS`); `src/worker/main.ts` + 3 test harnesses (new `sources` dep);
  `tests/support/stub-source-adapter.ts` (`itemVersion` + `mutateItem`).

### Red → Green

RED first confirmed at assertion level: unit `mergeChanged is not a function` (3 failing specs); the
integration + e2e suites referenced the not-yet-existing `ChangeRefreshConsumer` / `refreshResolvedFood`
/ `sources` dep. After implementation:

| Suite                                      | Before | After | Result   |
| ------------------------------------------ | ------ | ----- | -------- |
| Unit (food-service; +3 `mergeChanged`)     | 85     | 88    | ✅       |
| Integration (real PG; +4 refresh, +4 task) | 140    | 148   | ✅       |
| E2E (food-service; +7 change-refresh)      | 17     | 24    | ✅       |
| clerk-verify unit                          | 9      | 9     | ✅       |
| identity (regression check)                | 83     | 83    | ✅       |
| `npx tsc --noEmit` (app + infra)           | —      | —     | ✅ clean |
| `npm run lint` (food-service)              | —      | —     | ✅ clean |

T-170/T-171/T-172 marked `[x]`. No commit/push.

### Deferred (Phase 8 / infra, noted out of scope)

EventBridge `IngestionScheduled` schedule → ECS `RunTask` target + task definition + RunTask/exec IAM
roles (T-001c); field-level `manual`/`locked` provenance marker (DB-9 — prerequisite before a 2nd source
is wired); auth/HTTP wiring + DoS/IAM/user-erasure hardening; WebSocket notifications (P3).

---

## 2026-06-30 — Phase 8 HARDENING (T-049..T-057): fairness/DoS/erasure/provenance + client

**Tasks**: T-049 (fairness-by-demotion auth guarantee), T-050 (distinct-requester demand), T-051
(max-batch cap), T-052 (backpressure + flood-shed, auth/DoS side), T-053-code (async-producer
provenance), T-054 (auth-layer DoS protection), T-056 (user-erasure), T-057
(`@kitchensink/food-service-client`). TDD, tests-first.

### What shipped (NEW code)

- **T-054 auth-layer DoS protection** — `src/auth/auth-load-shedder.ts` (`AuthLoadShedder`): bounds
  concurrent token verifications + a per-source (IP) rolling-window `401`-rate cap, so a flood of
  well-formed-but-invalid tokens is shed with `503` BEFORE the CPU-bound signature check (SC-011 holds
  under flood). Wired into `FoodAuthGuard.use` (cheap `shouldShed` pre-check → `tryAcquire` slot →
  verify in `try/finally release`, `recordFailure` on the fail-closed `401`). Source key = leftmost
  `X-Forwarded-For` (ALB-set) else socket addr — used ONLY as a shedding bucket, never for identity.
  The shedder ctor param on the guard is `@Optional()` so Nest DI injects `undefined` and the
  process-wide `defaultShedder` (env-configured) applies — without `@Optional()` Nest tries to resolve
  `AuthLoadShedder` as a provider and aborts boot (caught by the e2e).
- **T-053 async-producer provenance** — `src/worker/provenance.ts` (`isValidPrincipal`/
  `hasValidProvenance`, pure) + `FetchQueueDao.listRequesterSubs` + a check in
  `FoodConsumerService.processRow`: a leased row whose recorded `fetch_requesters` set is empty or names
  the forbidden `'system'` shortcut is refused (tombstoned `unauthenticated_producer`, NO source call,
  new disposition `rejected_provenance`). Validates over `fetch_requesters` (FR-048: there is no
  `fetch_queue.requested_by` column).
- **T-056 user-erasure** — `FetchRequestersDao.deleteForSub` + `src/foods/user-erasure.service.ts`
  (`UserErasureService.eraseUser`, DI-provided/exported): on user deletion, delete that `sub`'s
  `fetch_requesters` rows (the only per-user data; no quota tables). Idempotent.
- **T-057 client** — rebuilt `packages/clients/food-service` (`@kitchensink/food-service-client`):
  `FoodServiceClient` with `addByName`/`batch`/`getById`/`getStatus`/`getCandidates`/`resolve`/`search`,
  user-or-M2M bearer attach (literal or per-request callback), and status→typed mapping
  (`401`/`403`/`400`/`404`/`409`/`503`/`202`/`200`; no per-user `429`; `CandidateMismatch`→`409`, DSN-14).
  Typed errors + `is*` guards; source-agnostic shapes (no `fdcId`). Added as a `food-service` devDep;
  `npm install --package-lock-only` run.

### Guarantee tests added (behavior already in the committed stack)

- T-049/T-050: `tests/fairness-demotion.integration.test.ts` — a food whose requesters ALL exceed 50
  pending is demoted while a lighter food drains first (SC-012, no `429`); auto re-promoted when any
  requester drops below 50; one `sub`'s repeats can't inflate priority (distinct-`sub` `request_count`,
  structural `PRIORITY_CAP=1`).
- T-051: covered by `tests/e2e/foods-api.e2e.test.ts` (batch > 100 → `400`, nothing enqueued).
- T-052: `tests/admission.integration.test.ts` — depth ceiling → `503` + jittered `Retry-After`;
  near-ceiling flood-shed of a heavy `sub`'s NEW enqueue while a lighter `sub` is admitted; reads/PATCH
  never pass through admission (structural). Durable cross-process circuit-breaker signal: NOTED as a
  follow-up (the worker's breaker is in-process; admission enforces the durable depth + flood-shed).

### Red → Green

RED first confirmed at assertion level: `provenance.ts` / `auth-load-shedder.ts` / the client modules
did not exist (import failures); the guard-DoS specs expected shedding the not-yet-wired guard would not
do. `npx tsc --noEmit` also caught two real test gaps (a `FoodSourceAdapter` missing `fetchByKey`; an
unused local) before green.

| Suite                                   | Before | After | Result   |
| --------------------------------------- | ------ | ----- | -------- |
| Unit (food-service)                     | 88     | 105   | ✅       |
| Integration (real PG)                   | 148    | 161   | ✅       |
| E2E (food-service)                      | 24     | 31    | ✅       |
| Client unit (`@kitchensink/...-client`) | 0      | 14    | ✅       |
| clerk-verify unit                       | 9      | 9     | ✅       |
| identity (regression check)             | 83     | 83    | ✅       |
| `tsc --noEmit` (food-service + infra)   | —      | —     | ✅ clean |
| `tsc --noEmit` (client)                 | —      | —     | ✅ clean |
| `tsc --noEmit` (identity)               | —      | —     | ✅ clean |
| `npm run lint` (food-service + client)  | —      | —     | ✅ clean |

T-049, T-050, T-051, T-052, T-054, T-056, T-057 marked `[x]`. T-053 code complete (consumer
provenance); its IAM least-privilege half is infra/CDK and is **deferred** (not `[x]` for the infra
part). No commit/push.

### Deferred (infra/CDK + P3 — out of scope here)

- T-053 IAM: named least-privilege producer roles (only named roles may `events:PutEvents` / insert into
  `fetch_queue`) — CDK.
- T-056 wiring: hook `UserErasureService.eraseUser` to the Clerk `user.deleted` event (a food-service
  deletion Lambda on the erasure fan-out, or the identity deletion worker calling the food M2M erasure
  path) — infra.
- T-054 production tuning: `FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS` / `FOOD_AUTH_SHED_THRESHOLD` /
  `FOOD_AUTH_SHED_WINDOW_MS` env defaults validated against real ALB traffic; ALB trusted-proxy / XFF.
- T-052 durable cross-process circuit-breaker signal (open breaker → `503` visible to the API tier).
- T-001c EventBridge→ECS RunTask + task def + IAM; migration runner (FU-MIGRATE); WebSocket (P3).
