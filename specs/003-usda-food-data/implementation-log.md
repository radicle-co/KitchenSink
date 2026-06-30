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
