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
