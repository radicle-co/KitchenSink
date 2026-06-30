# Adversarial Review — Feature 003 — Lens: db-architecture

**Reviewer stance:** assume the schema is wrong until proven right. Authoritative model =
`plan.md §2` (canonical + operational tables) + `v-model/architecture-design.md` (ARCH-006) +
`v-model/module-design.md` (MOD-006). Goal of this loop: confirm the docs are correct/complete
enough — AND that the load-bearing migration artifacts mirror them — to START implementation.

**Verdict: ISSUES (blocking).**

## Executive summary

The three canonical _design_ docs are internally consistent and, on the two hardest
integrity questions (worker lease/reaper and same-food provenance), **correct**:
`plan.md §2` Additions A/B/C, ARCH-006, and MOD-006 all describe `food_candidates`, the
`leased_at` lease column + reaper, `food_sources` `UNIQUE(food_id, id)`, and the composite
`(food_id, source_id)` FKs with `ON DELETE NO ACTION`. If implementation followed those docs
verbatim, the headline integrity items would be satisfied.

**However**, the worktree already contains hand-authored schema artifacts —
`packages/services/food-service/src/db/migrations/0000_food_schema.sql`,
`packages/services/food-service/src/db/schema/food.ts`, and
`packages/services/food-service/tests/schema.integration.test.ts` — and the task explicitly
scopes "the hand-authored 0000 SQL must exactly mirror the documented model." These artifacts
**regress every stabilization addition except `food_candidates`**:

- **No `leased_at` column** on `fetch_queue` (D-LEASE / Addition B) — the entire reaper/crash-
  recovery design (MOD-003 `leaseNext`/`reapExpiredLeases`) is unimplementable against this schema.
- **No `UNIQUE(food_id, id)` on `food_sources`** and **no composite `(food_id, source_id)` FKs** —
  instead plain single-column `source_id REFERENCES food_sources(id)`. This is **exactly the
  provenance hole** D-PROVENANCE-FK was created to close: a `food_nutrients` / `food_portions` /
  `food_field_provenance` row can cite a `food_sources` row belonging to a **different** food.
- The schema **integration test is fully stale** (asserts the removed `foods` / `fdc_id` /
  `fetch_status` / `usda_sync_metadata` / `usda_call_log` Phase 1–2 design) and would **fail** the
  moment a `DATABASE_URL` is present; it gives zero coverage of the documented model.

Because implementation will start from these files, they must be corrected to mirror the canonical
docs before coding proceeds. The docs themselves are right; the migration/schema/test are wrong.

Secondary (non-blocking) clean-architecture gaps: nutrient-dictionary dedup key, missing
non-negative CHECKs on nutrient amounts/gram weights, unconstrained free-text `fetch_state` /
`fetch_queue.status`, reaper indexing, an absent structural marker for "manual pick" protection, and
a dangling `drizzle.config.ts` schema path.

---

## CRITICAL / HIGH (block implementation)

### C1 — Migration & Drizzle schema omit `leased_at` (D-LEASE regressed)

`0000_food_schema.sql` `fetch_queue` (lines 121–131) and `food.ts` `fetchQueue` (lines 270–290)
**have no `leased_at timestamptz` column.** `plan.md §2` (line 285, Addition B), ARCH-003, and
MOD-003 all require it; MOD-003 `leaseNext` stamps `leased_at = now()` and `reapExpiredLeases`
reverts `status='in_flight' AND leased_at < now() - 30s`. The priority partial index is
`WHERE status='pending'`, so without the lease stamp + reaper a crashed worker orphans an
`in_flight` row **forever** — the precise failure D-LEASE prevents.
**Fix:** add `leased_at timestamptz` to both the 0000 SQL and `food.ts` `fetchQueue`. Mirror the
`§2` comment. (Optional but recommended: a partial index `ON fetch_queue (leased_at) WHERE
status='in_flight'` for the reaper — see M4.)

### C2 — Provenance hole: single-column `source_id` FKs (D-PROVENANCE-FK regressed)

In both artifacts the provenance FKs are plain single-column:
`"source_id" text NOT NULL REFERENCES "food_sources" ("id")` — 0000 SQL lines 73 (`food_nutrients`),
83 (`food_portions`), 90 (`food_field_provenance`), 104 (`food_category_assignment`); `food.ts`
lines 145–147, 172–174, 193–195, 227. This lets a value row reference a `food_sources` row of a
**different** `food_id` — the cross-food provenance corruption D-PROVENANCE-FK (and staff-review
"[C] provenance source_id can cross foods") closes. The canonical docs (`plan.md §2` lines 172,
199–200, 214–215, 226–227, 242–243; ARCH-006; MOD-006 lines 716–719) require
`food_sources UNIQUE(food_id, id)` + composite `FOREIGN KEY (food_id, source_id) REFERENCES
food_sources (food_id, id) ON DELETE NO ACTION`.
**Fix:** (a) add `CONSTRAINT food_sources_food_id_id_unique UNIQUE (food_id, id)` to `food_sources`;
(b) replace each single-column `source_id` FK with the composite `(food_id, source_id) →
food_sources(food_id, id) ON DELETE NO ACTION` on `food_nutrients`, `food_portions`,
`food_field_provenance`, and `food_category_assignment` (nullable `source_id` there relies on MATCH
SIMPLE to skip enforcement when NULL — keep that semantic). In `food.ts` express these via
`foreignKey({ columns: [t.foodId, t.sourceId], foreignColumns: [foodSources.foodId, foodSources.id] })`
plus a `unique().on(foodSources.foodId, foodSources.id)`; drop the inline single-column `.references()`.

### C3 — `0000_food_schema.sql` does not mirror the documented model (composite of C1+C2)

The task makes "the 0000 SQL must exactly mirror the documented model" a gate. As written it is the
**pre-stabilization** schema plus `food_candidates` bolted on. Beyond C1/C2 it also lacks the §2
`food_sources_food_id_id_unique` constraint. `plan.md §7` only shows table _skeletons_
(`CREATE TABLE food ( ... )`) and pushes the FK/lease DDL into prose/comments, so there is no
inline canonical DDL to diff the migration against — making this drift easy to miss.
**Fix:** regenerate `0000_food_schema.sql` to match `plan.md §2` byte-for-intent (C1+C2 applied),
and tighten `plan.md §7` so the migration section either inlines the full constraint DDL or contains
an explicit checklist (UNIQUE(food_id,id); 4× composite FK NO ACTION; `leased_at`) that a reviewer
can verify against §2.

### H1 — `schema.integration.test.ts` asserts the removed Phase 1–2 schema (false confidence)

`tests/schema.integration.test.ts` applies the new `0000_food_schema.sql` then queries
**`foods (fdc_id, fetch_status)`** (lines 53–64), \*\*`fetch_queue (fdc_id)` with raw `request_count

- 1`** (lines 67–82, contradicting D-DEMAND capped distinct count), **`usda_sync_metadata` id=1
singleton** (91–99), **`usda_call_log`** (101–108), and indexes **`idx_foods_search`/`idx_foods_fetch_status_fetched_at`/`idx_usda_call_log_called_at`** (116–121) — all of which were
removed by the re-baseline. Against a real DB this suite **throws "relation does not exist"**; it
only "passes" because it is `skipIf(!DATABASE_URL)`. There is therefore **no** test asserting the
documented invariants (same-food composite FK rejection, `leased_at`reaper reclaim,`food_candidates UNIQUE(food_id, source, external_key)`, distinct-requester demand).
**Fix:** rewrite the test against the 13-table model and add the D-PROVENANCE-FK negative test
(integration-test.md already calls for an ITP asserting a cross-`food_id` `source_id`is rejected),
a`leased_at` reaper-reclaim test (AT-018-A), and a candidate-uniqueness test (AT-RES1-x).

---

## MEDIUM (fix before/with schema work; not strictly blocking)

### M1 — Nutrient dictionary has no stable dedup key (dictionary fork risk)

`nutrient` has `UNIQUE(external_code)` but `external_code` is **nullable** (so multiple NULLs are
allowed, Postgres treating NULLs as distinct) and **`name` is not unique** (0000 SQL 58–64; `food.ts`
118–124; `plan.md §2` 178–184). A USDA nutrient lacking an `external_code` (or two adapters using
different codes for the same nutrient) can create duplicate `'Protein'` rows; since `food_nutrients`
de-dups only on `(food_id, nutrient_id)`, the same nutrient then splits across two dictionary ids and
the golden-value invariant silently breaks.
**Fix:** specify the dictionary upsert key in `plan.md §2` / MOD-006 (e.g. `UNIQUE(name)` or
`COALESCE(external_code, lower(name))`), and add the matching constraint to the schema. State how the
adapter resolves a source nutrient to a `nutrient_id`.

### M2 — No non-negative CHECKs on nutrient `amount` / portion `gram_weight`

`food_nutrients.amount` and `food_portions.gram_weight` are bare `numeric NOT NULL` with no domain
constraint (0000 SQL 71, 82; `food.ts` 143, 171). Nutrient amounts and gram weights are physically
non-negative; a sign/parse error in an adapter would persist silently and corrupt the golden record
(SC-008 fidelity). Bare `numeric` (arbitrary precision) is otherwise the correct choice for fidelity.
**Fix:** add `CHECK (amount >= 0)` and `CHECK (gram_weight > 0)` in `plan.md §2` DDL and the schema;
optionally note an explicit precision is intentionally omitted (arbitrary-precision numeric).

### M3 — Controlled vocabularies left as unconstrained free text

`food_sources.fetch_state` is `text DEFAULT 'fetched'` with **no CHECK and no enum** (comment claims
`fetched|error`; 0000 SQL 51, `food.ts` 100). `fetch_queue.status` is `text + CHECK` while every
other controlled set is a `pgEnum`; the decision register §1 even labels it the "Queue row status
**enum**." `plan.md §2`'s own preamble mandates "`pgEnum` for controlled enums." This is an
internal inconsistency and `fetch_state` is genuinely unconstrained.
**Fix:** either add `CHECK (fetch_state IN ('fetched','error'))` (or a `pgEnum`) and document the
deliberate text-vs-enum choice for `fetch_queue.status`/`fetch_state` (text+CHECK is defensible for
operational columns that evolve without `ALTER TYPE`), so the rule is consistent and stated.

### M4 — Reaper / `in_flight` access path is unindexed; `leaseNext` OR-clause defeats the partial index

`idx_fetch_queue_priority` is partial `WHERE status='pending'`, so it does **not** cover `in_flight`
rows. MOD-003 `reapExpiredLeases` (`WHERE status='in_flight' AND leased_at < now()-30s`) and
`leaseNext`'s `OR (q.status='in_flight' AND q.leased_at < ...)` (module-design lines 375, 393–394)
fall back to a seq scan. Tolerable at single-drainer/small scale, but it is an unindexed real access
path the task asks be covered.
**Fix:** add a partial index `ON fetch_queue (leased_at) WHERE status='in_flight'` to `plan.md §2`
and the schema, and note in MOD-003 that the reaper path relies on it.

### M5 — "Refresh never overwrites a manual pick" has no structural marker

D-LIFECYCLE / AT-LC-D assert refresh must never clobber a user's manual pick, but a PATCH-resolved
value is stored as **ordinary provenance** (`plan.md §5` candidate-resolution step 4) with no
`manual`/`locked`/`resolved_by` column on `food_nutrients`/`food_field_provenance`. Today the
invariant holds only indirectly (refresh re-fetches the _same_ `external_key` and never re-runs
disambiguation), and it **breaks the moment a second source is wired** and the merge engine applies
"higher-priority source wins" over a field the user effectively chose.
**Fix:** in `plan.md §2`/§5 + MOD-006/ARCH-017, state explicitly that "manual pick" is preserved at
the _crosswalk/item_ grain (no field-level lock at single-source launch), and record that a
`manual`/`locked` marker on value/provenance rows is a prerequisite before a 2nd source is added.
This closes the gap between the asserted invariant and the schema.

---

## LOW (polish / pre-impl hygiene)

### L1 — `drizzle.config.ts` points at a non-existent `usda.ts`

`drizzle.config.ts` line 23 sets `schema: './src/db/schema/usda.ts'` and its comment references
`src/db/schema/usda.ts` and the old `usda_sync_metadata` singleton seed; the actual file is
`food.ts` and the 0000 SQL has **no** sync-metadata seed. The `db:generate` hand-authoring aid is
therefore broken and the comment is stale.
**Fix:** point at `./src/db/schema/food.ts` and update the comment (drop the `usda_sync_metadata`
seed reference, or add the intended `source_sync_metadata` seed to the 0000 SQL).

### L2 — `food.name` nullable and dual-purpose (add-by-name query vs golden scalar)

`food.name` is nullable yet `§5` step 1 has the worker fan out on `food.name`, and the same column is
the merge-overwritten golden scalar. After a RESOLVED merge rewrites `name`, a later re-fan-out
(UNRESOLVED TTL re-request or change-refresh) keys off the golden name, not the original query.
Mostly mitigated because `FoodRequested.name` carries the request's name, but the conflation is a
latent smell.
**Fix:** document that the worker's first fan-out reads the creation-time `name` (= the add-by-name
query) and that re-requests carry their own `name`; consider whether `normalized_name` should be the
fan-out source of record.

### L3 — `updated_at` has no auto-update

`food.updated_at` defaults to `now()` but nothing maintains it on UPDATE (no trigger; app-set).
Acceptable per repo convention (app sets it), but state it so reviewers don't expect a trigger.

---

## What is correct (verified, no change needed)

- `food_candidates` (Addition A) is present and consistent across `plan.md §2`, ARCH-006/ARCH-016,
  MOD-006/MOD-018, the 0000 SQL, and `food.ts`, incl. `UNIQUE(food_id, source, external_key)` and
  the metadata-only / re-fetch-on-pick design (no per-candidate nutrient rows).
- Read-by-id golden-record assembly is fully indexed (`food` PK; `food_nutrients_food_id_idx`;
  `food_portions_food_id_idx`; `food_field_provenance` PK(food_id,field); assignment PK(food_id,…)).
- `pg_trgm` fuzzy search (GIN on `name`/`description`), barcode partial index, and the
  `food_sources UNIQUE(source, external_key)` external-key/barcode lookup path are all present.
- Worker drain `ORDER BY request_count DESC, first_requested ASC ... FOR UPDATE SKIP LOCKED` is
  backed by `idx_fetch_queue_priority`; per-source rolling-window COUNT by
  `idx_source_call_log_source_called_at`; per-sub demotion count by `idx_fetch_requesters_sub`.
- `source_call_log` retention/prune rule (FR-020) is documented; the (source, called_at) index
  serves both the window COUNT and the prune.
- Transactional golden-record writes (MOD-016 `upsertGoldenRecord` over a `tx`) and the
  distinct-requester capped enqueue (D-DEMAND) are correctly specified in the docs.
- No EAV, no `raw_json`, no denormalized nutrient columns, no `fdcId`/`fetch_status` on the canonical
  schema — normalization is clean; the `nutrient` dictionary correctly hoists `unit`.
