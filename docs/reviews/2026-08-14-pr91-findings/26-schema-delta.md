# 26 — Schema delta for D-LIVE (live reference) and D-SHELL (placeholder rows)

**Date**: 2026-08-14
**Mode**: adversarial schema design, READ-ONLY. **No database was connected to.** Every schema claim below is
read from a Drizzle definition or a hand-authored migration file and cited `file:line`.

**Builds on** (not repeated here): `09-data-model.md` F-DB1–F-DB16 and D-1–D-10; `12-adversarial-status-shells.md`
A-3/A-4/A-8; `15-adversarial-food-recipe-model.md` A-1/A-4/A-5; and `16-adversarial-live-reference.md` A-1–A-6,
which established that the system implements **neither** live reference **nor** snapshot but a per-field
accumulating cache under a stale denormalized copy. This document is the **delta that makes D-LIVE and D-SHELL
true**, and it **reverses two prior recommendations** where new evidence contradicts them (marked ⟲).

**Decisions being implemented**

- **D-LIVE** — a recipe's nutrition is a live reference to the shared catalog; snapshots rejected. Owner-accepted
  carve-out: 009's `nutrition_compliance.actual_*` is a recorded historical series and must not be rewritten by
  catalog changes.
- **D-SHELL** — the food service creates placeholder rows and advances status until USDA data completes the entry.

---

## Ships today vs required

### Recipe service — `packages/services/recipe-service/src/database/` (migration head `0018`)

| Concern                             | Ships today                                                                                                      | Evidence                                                                                                             | Required for D-LIVE                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Per-100g catalog projection         | `ingredients.calories_per_100g` / `protein_g_per_100g` / `carbs_g_per_100g` / `fat_g_per_100g`, `portions` jsonb | `schema/ingredients.ts:59-65`                                                                                        | keep                                                          |
| Nutrition write discipline          | `COALESCE(new, old)` per field — accumulating                                                                    | `ingredients/dal/ingredients.dal.ts:373-378`                                                                         | **REPLACE** with explicit NULL on an observation              |
| Freshness anchor on the projection  | **none** — `created_at` only                                                                                     | `schema/ingredients.ts:67`                                                                                           | **ADD** `status_updated_at`, `resolved_at`, `food_updated_at` |
| Ordering guard on status writes     | **none** — bare `WHERE id = $n`                                                                                  | `ingredients.dal.ts:380`                                                                                             | **ADD** `resolution_sequence` (F-DB7 / A-3, unchanged)        |
| Placeholder shape invariant         | CHECK on the status _domain_ only (`NULL IN (…)` passes)                                                         | `schema/ingredients.ts:70-73`                                                                                        | **ADD** `ingredients_backing_coherent` (F-DB3, unchanged)     |
| Value-plausibility bound            | **none** on any of the four macro columns                                                                        | `schema/ingredients.ts:59-62`; constraint list `ingredients.ts:70-73`                                                | **ADD** physical bounds (see Containment)                     |
| Card calories                       | `recipes.lead_calories_per_serving numeric(8,1)`, written at create/update/clone only                            | `schema/recipes.ts:124`; `recipes.service.ts:488`, `:648-655`, `:779`; read at `search/dal/search.dal.ts:82,149,201` | **DROP** (see next section)                                   |
| Denormalized-aggregate precedent    | rating aggregate maintained by 3 statement-level triggers + coherence CHECK                                      | `migrations/0010_ratings_difficulty_cover.sql:79-123`; CHECK at `:42-43` / `schema/recipes.ts:160`                   | precedent applies to the **invariant**, not the mechanism     |
| `recipe_ingredients` user overrides | four `user_*` numerics, **no CHECK**                                                                             | `schema/ingredients.ts:117-120`; only constraint is `quantity > 0` at `:123`                                         | **ADD** bounds (F-DB13, extended)                             |

### Food service — `packages/services/food-service/src/db/` (migration head `0004`)

| Concern                                | Ships today                                                                         | Evidence                                                                                        | Required for D-SHELL                               |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Placeholder row                        | `food.status` default `PENDING`; 5-value enum                                       | `schema/food.ts:44`, `:95`                                                                      | keep — this **is** the shell (D-1 stands)          |
| Guarded advance                        | `LEGAL_PRIORS` + conditional `UPDATE … WHERE status IN (…)`, throws on `rowCount≠1` | `foods/dao/food.dao.ts:182-188`, `:303-333`                                                     | keep — strongest thing at the seam                 |
| Terminal state + TTL                   | `tombstoned_at`; reactivation past TTL on the same id                               | `schema/food.ts:100`; `food.dao.ts:254-266`                                                     | **ADD** failure counter + backoff                  |
| Terminal/tombstone coherence           | maintained **in code only**; nothing forbids the incoherent pair                    | `food.dao.ts:306-320`                                                                           | **ADD** CHECK                                      |
| Deletion / reclamation                 | **no `DELETE FROM food` anywhere**; only `food_candidates` has a TTL delete         | `foods/dao/food-candidates.dao.ts:171-177`                                                      | ⟲ **keep it that way** — see Placeholder lifecycle |
| Nutrient dictionary                    | `UNIQUE(name, unit)` **and** `UNIQUE(external_code)`                                | `schema/food.ts:190-191`                                                                        | keep; the second is vacuous (below)                |
| `external_code` population             | **always `null`** — every producer hard-codes it                                    | `sources/usda/usda.adapter.ts:332`, `:395`, `:397`; `sources/usda/bulk/usda-bulk.parser.ts:210` | ⟲ **cannot be a selection key**                    |
| Golden-record nutrient read            | `SELECT … FROM food_nutrients JOIN nutrient WHERE food_id = $1` — **no `ORDER BY`** | `foods/dao/food.dao.ts:436-447`                                                                 | **ADD** deterministic order                        |
| Value validation at the merge boundary | format only: non-empty name/unit, `^\d+(\.\d+)?$`, valid basis                      | `foods/merge/merge-sanitize.ts:16-40`, `:51-67`                                                 | **ADD** magnitude gate (Containment)               |
| Nutrient history / audit               | **none** — `food_nutrients` overwritten in place by `upsertValue`                   | `schema/food.ts:211-236`; `merge/merge-and-persist.service.ts:223-240`                          | **ADD** append-only history                        |

### Not yet built (specified here, migrated later)

`nutrition_compliance` and every other 009 table. Verified absent by the search recorded in `09-data-model.md`
F-DB14. 009 is currently DDL-in-a-plan (`specs/009-nutrition-planning/plan.md:72-87`) with `created_at` and no
as-of column. **The carve-out is free today and a data migration after 009 ships.**

---

## `lead_calories_per_serving` decision + justification

**Decision: DROP the column. Compute the card's calories at read time, per page, from the current catalog.**

### Why not the FR-013a trigger (option b)

FR-013a's standard is right and I am adopting it: a denormalized aggregate must be _"consistent with the [data] it
summarizes at all times"_ and _"it MUST NOT be possible for a write path to bypass its maintenance and leave it
stale"_ (`specs/001-commise-recipe-app/spec.md:148`). But the precedent establishes an **invariant**, not a
**mechanism**, and the mechanism does not transfer. Two disqualifying tests:

**Test 1 — is the derivation expressible in SQL?** The rating aggregate is `COUNT()` + `AVG()`
(`0010_ratings_difficulty_cover.sql:95-100`) — SQL expresses the entire business rule, so the trigger holds _one_
authoritative representation. Lead calories is not: it needs `unitToGrams` (`packages/shared/recipe-core/src/units.ts`),
a lookup into the `portions` jsonb for volumetric/count units, the strict user-override priority
(`nutrition.ts:1-16`), and the `isComplete` exclusion rule. Reimplementing that in plpgsql creates a **second
authoritative representation of a business rule** whose drift from `recipe-core` is undetectable by any test that
does not run both. That is a DRY violation on _knowledge_, which is the one kind DRY actually forbids.

**Test 2 — what is the blast radius?** The rating trigger's transition table is bounded by the statement that fired
it. A lead-calories trigger would have to fire on `UPDATE ingredients`, and `ingredients` is a **shared, ownerless
catalog** (`ingredients.dal.ts:17-18`). One `updateResolution` on a common row ("salt", "olive oil") would `UPDATE
recipes` for potentially every recipe on the platform, taking row locks on all of them — **inside a deliberately
unthrottled user-facing `GET`** (`ingredients.controller.ts:256-259`: _"NO throttle decorator"_). An unbounded
write fan-out inside an unthrottled GET on a shared row is not shippable regardless of the DRY problem.

Option (b) is therefore rejected on mechanism, not on principle.

### Why not the declared as-of cache (option c)

Option (c) is the rejected snapshot, readmitted for the card. It is _honest_ — which is its whole merit, and why it
is the flip condition below — but it delivers a product where the card and the detail legitimately disagree and the
UI has to explain why. Under D-LIVE that is a worse product than paying two index scans per page.

### Why (a) is right, and what it costs

- **It is the only option that makes D-LIVE true.** Card and detail become the same read-time fold over the same
  current catalog rows, via the same pure functions (`assembleNutritionLines` → `leadCaloriesPerServing` /
  `computeRecipeNutrition`, `recipes.service.ts:377-399`). No invalidation, no second source of truth, no staleness.
- **It is not an N+1.** The list projection already returns ≤ page-size recipes. The fold needs exactly **two more
  bounded index scans**: `recipe_ingredients WHERE recipe_id = ANY($1)` (served by `idx_recipe_ingredients_recipe_id`,
  `schema/ingredients.ts:124`) and `ingredients WHERE id = ANY($2)` (PK). `IngredientsDal.findByIds` already exists
  and is already the detail path's loader (`recipes.service.ts:384`). The N+1 the column was created to avoid
  (`0012_lead_calories_per_serving.sql:5-7`) is a _per-recipe_ read; a batched `ANY($1)` is not that.
- **It makes an existing false docstring true.** `nutrition.ts:62-69` claims card and detail _"can never disagree"_.
  That is false today (16/A-2) and true under (a) — modulo the interval between two reads, which is what "live" means.
  The comment still needs rewording to say _why_ (both are read-time folds over the current catalog), not to be deleted.
- **It removes a divergence from the GDPR portability artifact.** The account export ships the stored string
  (`account/export.mappers.ts:60`; typed `z.string().nullable()` at `account/account.schema.ts:239` and
  `packages/schemas/recipe/src/schemas/account.schema.ts:250`), i.e. the _stale_ figure, while the UI shows the live
  one. Under (a) there is one number.
- **It matches the repo's own most recent ruling on this exact question.** 006 reversed a stored nutrition rollup to
  a pure read-time fold — _"A snapshot is a second source of truth that goes stale on every recipe edit"_
  (`specs/006-meal-planning/research.md:447`) — and made its absence a permanent system-test guard
  (`specs/006-meal-planning/v-model/system-test.md:100`, `v-model/hazard-analysis.md:108`). `lead_calories_per_serving`
  is the same object one layer down.

**Costs, stated plainly.** Two extra round trips per list/search/collection page and a fold in the service layer;
a wire-shape change on the account export (`leadCaloriesPerServing` stops being a numeric-as-string column read and
becomes a computed number) which is a **one-way door** under ADR-0014 and must be authored in-service and copied to
`packages/schemas/recipe`; and the drop itself is gated on measurement (see Measurement gate) because I have not run
a plan and will not claim the fold is cheap on reasoning alone.

**Flip condition to (c).** If the measured list read regresses beyond the agreed budget at production-shaped scale,
keep the column and make it **explicitly as-of**: add `lead_calories_as_of timestamptz NOT NULL DEFAULT now()`, set
it on every recompute, and **expose `leadCaloriesAsOf` on the wire**. A silent as-of cache is the current defect;
a declared one is a defensible product decision. Do not take (c) without exposing the timestamp.

---

## Deterministic golden record

Three independent defects compose into a non-deterministic ×4.184 error in the app's headline number. All three
must be fixed; fixing any one alone leaves the failure reachable.

### ⟲ New finding that reverses a prior recommendation: `external_code` is dead

`15-adversarial-food-recipe-model.md` A-1 recommended _"Match nutrients by `external_code` first"_. **That is not
implementable.** Every producer of a canonical nutrient sets `code: null` — `usda.adapter.ts:332`, `:395`, `:397`
(live API, both `foodNutrients` and `labelNutrients` paths) and `usda-bulk.parser.ts:210` (bulk seed). It flows to
`NutrientDao.resolveOrCreate` via `merge-and-persist.service.ts:229` and `:334`, so
`nutrient.external_code` is universally `NULL` and `unique('nutrient_code_unique')` (`schema/food.ts:190`) is
vacuous — `NULL`s do not conflict in a Postgres UNIQUE. Independently, the wire shape carries **no code field at
all**: `nutrientViewSchema` is `{ nutrient, amount, unit, basis, source }`
(`packages/schemas/food/src/schemas/foods.schema.ts:75-86`), so the recipe service could not match on a code even if
one existed.

Consequence: **the only usable key is `(name, unit)`** — which is exactly the dictionary's real unique key
(`schema/food.ts:191`). Populating `external_code` from FDC's `nutrient.number` is a worthwhile separate change
(it would survive a USDA display-name change), but it is a food-service + wire change under ADR-0014 and is **not**
a prerequisite for the fix below. Do not block on it.

### The three layers

**L1 — Deterministic wire order (food service).** `readGoldenRecord`'s nutrient select has no `ORDER BY`
(`food.dao.ts:436-447`), so under a sequential scan the wire order is physical heap order, and `upsertValue`
(`merge-and-persist.service.ts:223-240`) relocates tuples on every refresh. A refresh that changes nothing about
energy can therefore flip which `Energy` row is first.

```sql
-- in FoodDao.readGoldenRecord's nutrient select
ORDER BY nutrient.name ASC, nutrient.unit ASC, food_nutrients.nutrient_id ASC
```

`nutrient_id` is the tiebreak that makes the order **total** (name+unit is unique in the dictionary, so it is
already total in practice; the third key is defence against a future dictionary change). This is a code change, not
a migration. It does not fix the selection — it stops the value from _changing under a user_, which is the property
D-LIVE claims and does not have.

**L2 — Exact-match selection against a whitelist (recipe service).** `nutrientPer100g` takes
`Array.prototype.find`'s first name-substring hit and ignores `unit`, which is on the wire and unused
(`ingredients.service.ts:59-67`, `:124-136`). Two live mis-selections beyond kcal/kJ: `'Fatty acids, total saturated'`
lowercases to a string containing `'fat'`, and `'Total lipid (fat)'` contains both `'lipid'` and `'fat'`, so the fat
macro can bind to saturated fat.

Replace the substring predicate with an exact `(name, unit)` whitelist over the canonical spellings the adapters
produce (`canonicalizeNutrientName` sentence-cases; `LABEL_NUTRIENT_MAP` at `usda.adapter.ts:102-117` fixes the
names):

| macro    | `(name, unit)`                         |
| -------- | -------------------------------------- |
| calories | `('Energy', 'kcal')`                   |
| protein  | `('Protein', 'g')`                     |
| carbs    | `('Carbohydrate, by difference', 'g')` |
| fat      | `('Total lipid (fat)', 'g')`           |

Two rules go with it, and they are the point:

1. **A `kJ` Energy row is not a fallback.** If no `('Energy','kcal')` row exists, calories are `undefined` and the
   line flips `isComplete` false (`nutrition.ts:12-16`). Converting kJ→kcal silently is how you get a number nobody
   can audit; refusing is how the UI already handles unaccountable lines.
2. **Two hits for one macro is a defect, not a choice.** `UNIQUE(food_id, nutrient_id)` (`schema/food.ts:226`)
   permits one row per _dictionary entry_, and kcal and kJ are two entries, so a food may legitimately hold both.
   With an exact `(name, unit)` whitelist only one of them can ever match, so the ambiguity is designed out rather
   than resolved by luck.

**Whitelist risk, and how to retire it.** A whitelist that misses a real spelling yields silent `NULL` nutrition —
which fails _safe_ (the aggregator excludes the line and flags `isComplete: false`) and is observable, unlike today's
failure which is a wrong number. It must nonetheless be validated: `SELECT DISTINCT name, unit FROM nutrient ORDER BY
1,2` against a bulk-seeded database, before the change ships (see Measurement gate). This is the strongest argument
for populating `external_code` later.

**L3 — Physical bounds on the recipe-side projection (schema).** L1+L2 are application code and can be regressed by
an edit. The durable backstop is a CHECK on the columns a recipe actually reads — see Containment. This is the layer
that turns "calories silently ×4.184" into a loud constraint violation.

### `COALESCE` → explicit NULL: yes, with a typed observation

`updateResolution` coalesces each of the four macros and `portions` (`ingredients.dal.ts:373-378`), so a refresh that
_loses_ a nutrient leaves the old value in place — a row whose calories are from one food version and whose protein
is from another. `sanitizeCandidates` makes that reachable rather than theoretical: it **silently drops** a nutrient
whose amount fails `^\d+(\.\d+)?$` or whose name/unit is blank (`merge-sanitize.ts:23-30`, `:59-63`), and
`mergeChangedSources` only ever **upserts** — it never deletes a `food_nutrients` row
(`merge-and-persist.service.ts:223-240`). So the golden record can shed a nutrient on the food side, and the recipe
side will keep the stale one forever.

Under D-LIVE that is not an acceptable storage semantic: "current nutrition" requires all four macros to share one
as-of basis. **Replace, do not coalesce.**

The naive fix breaks a live path: `refreshStatus` calls `updateResolution` with **no** nutrition for every
non-`RESOLVED` status and on the terminal catch (`ingredients.service.ts:405-419`), so a blanket replace would NULL
a resolved row's nutrition on the next `PENDING` observation. Make the two cases different types instead of
different values — parse, don't validate:

```ts
type NutritionObservation =
    | { readonly kind: 'none' } // status-only advance: nutrition untouched
    | {
          readonly kind: 'golden';
          readonly nutrition: IngredientNutrition;
          readonly portions: readonly IngredientPortion[];
      }; // a RESOLVED read: REPLACE all five columns
```

`'golden'` writes all four macros and `portions` unconditionally — an absent macro writes `NULL`. `'none'` omits the
assignments from the statement entirely. `IngredientNutrition`'s fields are already optional
(`extractNutrition`, `ingredients.service.ts:124-136`), so `undefined → NULL` is the natural mapping.

---

## The 009 carve-out

**Where the boundary sits, in one sentence to be copied verbatim into the ADR:**

> **Forward-looking projections are live; recorded past outcomes are pinned at record time.** Recipe detail, recipe
> cards, 006 planner totals and any "what would I eat" figure read the catalog as it is now. 009's
> `nutrition_compliance.actual_*` — and any future consumption log — record what a user _did_ eat on a _past_ date
> and are never recomputed once that date closes.

This is the only place D-LIVE does not apply, and it is not a compromise: 006's own justification for live totals is
_"there is no requirement for historical fidelity"_ (`specs/006-meal-planning/spec.md:345-347`), and for a series
literally named `actual_*` historical fidelity **is** the requirement. The two features are not making the same trade.

### What copies at record time, and what does not

| Datum                                                               | Live or pinned                                 | Why                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `nutrition_plans.target_*`                                          | live (current targets)                         | a target is a present intention                                                                                               |
| `nutrition_compliance.planned_*`                                    | **pinned**                                     | the target _in force on that day_; a later goal change must not retroactively rewrite whether the user hit yesterday's target |
| `nutrition_compliance.actual_*`                                     | **pinned**                                     | the recorded outcome                                                                                                          |
| `actual_is_complete`                                                | **pinned**                                     | `recipe-core`'s `isComplete` must travel with the number or the number is uninterpretable                                     |
| `compliance_status`                                                 | **pinned** (derived from the two pinned sides) | must not flip from `on_track` to `over` in August because USDA revised a chicken entry                                        |
| `GET /nutrition-plans/{id}/compliance` for **today / a future day** | live                                           | the day is open; recompute is correct                                                                                         |
| the meal-plan entries the rollup folded                             | not copied — see below                         |                                                                                                                               |

### DDL (specification, not a migration — 009 has no tables yet)

```sql
CREATE TABLE nutrition_compliance (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nutrition_plan_id  uuid NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
    day                date NOT NULL,                 -- 'date' is a reserved-ish column name; 'day' reads better

    planned_calories   numeric(8,1),  planned_protein_g numeric(8,2),
    planned_carbs_g    numeric(8,2),  planned_fat_g     numeric(8,2),
    actual_calories    numeric(8,1),  actual_protein_g  numeric(8,2),
    actual_carbs_g     numeric(8,2),  actual_fat_g      numeric(8,2),
    actual_is_complete boolean NOT NULL,               -- recipe-core isComplete, carried forward

    compliance_status  text NOT NULL,

    -- THE CARVE-OUT, in three columns:
    computed_at        timestamptz NOT NULL DEFAULT now(),  -- as-of basis of actual_*/planned_*
    source_digest      text NOT NULL,                       -- hash of the (recipeId, servings, per-serving macros)
                                                            -- tuples that produced actual_* — see below
    sealed_at          timestamptz,                         -- NULL = open day (recomputable); NOT NULL = immutable

    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT nutrition_compliance_plan_day_unique UNIQUE (nutrition_plan_id, day),
    CONSTRAINT nutrition_compliance_status_check
        CHECK (compliance_status IN ('on_track','over','under')),
    CONSTRAINT nutrition_compliance_seal_after_compute
        CHECK (sealed_at IS NULL OR sealed_at >= computed_at)
);

CREATE INDEX idx_nutrition_compliance_plan_day ON nutrition_compliance (nutrition_plan_id, day DESC);
-- the nightly rollup's work list: only OPEN days are recomputable, so the index shrinks to ~1 row per plan
CREATE INDEX idx_nutrition_compliance_open ON nutrition_compliance (day) WHERE sealed_at IS NULL;
```

**Immutability enforced in the database, not in the worker.** This is where the FR-013a trigger precedent _does_
transfer — the rule is fully expressible in SQL and the blast radius is one row:

```sql
CREATE OR REPLACE FUNCTION nutrition_compliance_sealed_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD.sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'nutrition_compliance % is sealed at % and is immutable', OLD.id, OLD.sealed_at
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_nutrition_compliance_sealed_no_update
    BEFORE UPDATE ON nutrition_compliance
    FOR EACH ROW EXECUTE FUNCTION nutrition_compliance_sealed_immutable();
```

**Deliberately `BEFORE UPDATE` only, not `BEFORE DELETE`.** A `BEFORE DELETE` trigger also fires on the cascade from
`nutrition_plans`, which would make the row **un-erasable** and put the immutability guarantee in direct conflict
with GDPR Art. 17 — and 009's data is classified special-category health data
(`specs/009-nutrition-planning/plan.md:26-34`). "Immutable" here means _the recorded numbers cannot be rewritten_,
never _the subject cannot be forgotten_. Residual risk, stated: a delete-then-reinsert can still fabricate a row;
that is a larger breach than a stray UPDATE and is not defensible against from inside the table.

**Sealing rule.** The nightly rollup (`specs/009-nutrition-planning/plan.md:140`, `:275`) recomputes only
`WHERE sealed_at IS NULL`, and seals a day once it is past in the _plan owner's_ timezone plus a grace window
(late logging is real). Sealing is the single write that flips the row from live to pinned; after it, the row is a
record.

**`source_digest`, and what it buys.** A hash over the ordered `(recipeId, servings, perServingMacros)` tuples the
fold consumed. It is not a full input snapshot — it cannot reconstruct the meal — but it answers the one question a
rectification request under Art. 16 actually asks: _"have the inputs to this number changed since it was recorded?"_
Comparing today's digest against the sealed one gives a yes/no with no storage cost proportional to the meal plan.
If the owner wants full reconstruction, that is a `nutrition_compliance_inputs` child table and should be decided
explicitly (open decision C-3), not discovered later.

**Cross-service note, not re-litigated here.** ADR-0017's 2026-08-14 amendment moved 006 into
`@kitchensink/meal-plan-service` with its own database, so the rollup now reads meal plans over HTTP and
`meal_plan_id` is an opaque un-FK'd identifier. `09-data-model.md` F-DB14 owns that correction; the carve-out above
is independent of where the meal plan lives, because everything it pins is copied by value.

---

## Placeholder lifecycle & reclamation

### Making illegal states unrepresentable

**Food side.** `setStatus` maintains "terminal ⇔ tombstoned" in code (`food.dao.ts:306-320`) and nothing forbids the
incoherent pair. Mirror `recipes_rating_aggregate_coherent` (`schema/recipes.ts:160`):

```sql
ALTER TABLE food ADD CONSTRAINT food_terminal_tombstone_coherent
    CHECK ((status IN ('NOT_FOUND','FAILED')) = (tombstoned_at IS NOT NULL)) NOT VALID;
```

**Recipe side.** `ingredients_backing_coherent` (`09-data-model.md` F-DB3) — unchanged, adopted verbatim, and it is
still the cheapest correctness win in this review. Its fourth illegal state (`food_id IS NULL AND is_user_entered =
false`) matches **neither** partial unique index (`schema/ingredients.ts:77-84`) and so dedups against nothing.

**What cannot be a CHECK.** "A `PENDING` shell holds no nutrients" is cross-table and not expressible as a CHECK. It
is upheld by the flow — nutrients are written in the same transaction that sets `RESOLVED`
(`merge-and-persist.service.ts:141-148`) — and it is the predicate the reclamation query below relies on, so it must
be asserted by an integration test rather than by the schema.

### Terminal failure state

Today `FAILED` and `NOT_FOUND` are both **reactivatable**: `LEGAL_PRIORS.PENDING = ['FAILED','NOT_FOUND']`
(`food.dao.ts:183`) and `createByName`'s `ON CONFLICT` promotes a tombstoned row back to `PENDING` once
`FOOD_NOT_FOUND_TTL_DAYS` has elapsed (`food.dao.ts:254-266`). That is correct for a food USDA may later add and
wrong for `"a pinch of love"`, which cycles `PENDING → FAILED → 30d → PENDING` forever, burning a `fetch_queue` slot
and a source-API call against the rolling limiter (`schema/operational.ts:107-115`) on every cycle.

**Recommendation: a failure counter with exponential backoff, not a sixth status.**

```sql
ALTER TABLE food ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE food ADD CONSTRAINT food_consecutive_failures_nonneg CHECK (consecutive_failures >= 0) NOT VALID;
```

`setStatus` increments it on a terminal transition and resets it to 0 on `RESOLVED`. `createByName`'s reactivation
predicate changes from a flat TTL to a backed-off one:

```sql
-- reactivation interval = base_ttl * 2^least(consecutive_failures, cap)
food.tombstoned_at < now() - (<base_ttl_interval> * power(2, least(food.consecutive_failures, <cap>)))
```

Backoff rather than a hard block, deliberately: the food catalogue genuinely grows, and a name that fails ten times
in 2026 may resolve in 2028. Admin `POST /api/v1/foods/{id}/refetch` (`foods.controller.ts:137`, already
`FOOD_ADMIN_SCOPE`-gated) stays an unconditional override.

**Why not a sixth `food_status` value (`ABANDONED`).** It is the more legible model and I am not choosing it, for
three costed reasons. (1) It is a **coordinated two-service wire change** under ADR-0014: `food_status` enum,
`foodStatusSchema`'s deliberate `pending|terminal|RESOLVED` partition and its exhaustiveness test
(`packages/schemas/food/src/schemas/foods.schema.ts:60-73`), the contract hash, the client, the recipe-side
`FOOD_RESOLUTION_STATUSES` (`schema/ingredients.ts:35-41`) and its CHECK domain (`:70-73`). (2)
`ALTER TYPE … ADD VALUE` is **irreversible** — Postgres has no `DROP VALUE`. (3) It buys no behaviour: the clients
already treat `NOT_FOUND`/`FAILED` as terminal and offer the freeform fallback (`ingredients.service.ts:18-24`).
That partition test means adding it later is a _detected_ change, not a silent one — which is exactly what makes
deferring safe. Recorded as open decision C-4.

### ⟲ Reclamation: nothing is deleted, and that is the correct design

`12-adversarial-status-shells.md` A-8 recommended a reaper that _"deletes"_ a stale shell, and
`09-data-model.md` D-7 recommended a sweep. **I am reversing the delete half**, and the reason is D-LIVE itself.

`ingredients.food_id` is an opaque cross-database reference with **no FK** (`schema/ingredients.ts:53-55`), so the
food service cannot know whether a row is referenced. Trace the two cases:

- **A never-resolved shell is deleted.** The next poll gets a 404, `refreshStatus`'s catch writes the terminal
  status (`ingredients.service.ts:414-419`), and the picker falls back to freeform. **Safe** — but it buys almost
  nothing, because the row is a few hundred bytes and the name it occupies is _already_ re-triable via the TTL
  reactivation path.
- **A `RESOLVED` food is deleted.** The recipe holds nutrition copied from it and, because a client stops polling a
  terminal/resolved row by design, **nothing ever re-reads it**. The recipe keeps that nutrition forever with no
  live referent — which is precisely the state D-LIVE exists to forbid. **Unsafe, and undetectable.**

Since the food service cannot distinguish the two cases from the outside without a reverse cross-service query, the
invariant should be the strong one:

> **RECLAMATION INVARIANT — a `food` row is never deleted. A food id, once minted, means the same thing forever or
> means "gone" (404); it never means something else.** Reclamation marks and suppresses; it does not remove.

What _is_ reclaimed, and where the growth actually is:

1. **The stalled-`PENDING` orphan (F-DB2)** — a committed `food` row whose enqueue was shed by admission
   (`foods.service.ts:208-216`, `:264` vs `:287`). Sweep it to `FAILED` through `FoodDao.setStatus` so the tombstone
   is stamped and the guarded transition is honoured (`PENDING → FAILED` is legal, `food.dao.ts:187`):

    ```sql
    -- worker-side sweep; interval from settingFromEnv, never a SQL literal (food.dao.ts:166-174)
    SELECT f.id FROM food f
     WHERE f.status = 'PENDING'
       AND f.created_at < now() - <stall_interval>
       AND NOT EXISTS (SELECT 1 FROM fetch_queue q WHERE q.food_id = f.id)
    ```

    `fetch_queue.food_id` is the table's **primary key** (`schema/operational.ts:31-33`), so the `NOT EXISTS` is a PK
    probe, not a scan.

2. **`UNRESOLVED` is deliberately NOT swept.** `FoodCandidatesDao.clearExpired` already records the rule —
   _"The owning `UNRESOLVED` food is deliberately left untouched — it is never swept to `NOT_FOUND`"_
   (`food-candidates.dao.ts:160-163`) — and `LEGAL_PRIORS.FAILED = ['PENDING']` (`food.dao.ts:187`) makes
   `UNRESOLVED → FAILED` illegal anyway. An `UNRESOLVED` food is waiting for a human; that is a legitimate resting
   state. Do not "fix" it.

3. **The bounded side-tables already reclaim themselves**: `food_candidates` by TTL delete
   (`food-candidates.dao.ts:171-177`), `fetch_queue`/`fetch_requesters` by deletion on resolve
   (`foods/dao/fetch-queue.dao.ts` resolve/tombstone).

**What actually grows, and the metric that governs it.** The `food` table grows with distinct user-typed strings —
thousands per bulk import. Search is unaffected semantically (`FoodSearchDao` filters `status = 'RESOLVED'` on both
branches, `foods/dao/food-search.dao.ts:221`, `:255`) but the trigram indexes on `name` still carry the shells.
`0004_food_name_trgm_gist.sql:35-38` records that scoping those indexes to `RESOLVED` _"measured no faster (2% fewer
rows)"_ — true at a 2% shell fraction and false at 50%. So: **instrument the shell fraction**
(`count(*) FILTER (WHERE status <> 'RESOLVED') / count(*)` on `food`) and treat crossing an agreed threshold as the
named trigger to re-measure index partiality. That is a measurement-gated future decision with an explicit
condition, not a guess.

### A recipe referencing a reclaimed shell

Because nothing is deleted, the answer is fully defined by shipped code and needs no new mechanism:

| Shell state                                           | What the recipe sees                                            | Path                             |
| ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| swept `PENDING → FAILED`                              | terminal status on next poll → freeform fallback offered        | `ingredients.service.ts:405-411` |
| reactivated past backoff TTL, **same id**             | ⚠️ the recipe row still says `NOT_FOUND` and is never re-polled | 15/A-4(i) — unresolved, see C-5  |
| food row 404s (should not happen under the invariant) | terminal status written from the catch                          | `ingredients.service.ts:414-419` |

The middle row is the residual and it is a **semantic discontinuity on a stable id**: the same `food_id` goes from
"no such food" to a fully resolved substance, and the recipe never learns. Two coherent answers — re-check terminal
rows against a stored `tombstone_anchor`, or mint a **new** food id on reactivation — and the current design picks
neither. Escalated as open decision C-5; it is not resolvable inside a schema delta.

---

## Containment

**What stops one bad catalog write reaching every recipe today: nothing. Stated plainly.** The full chain, verified:

- **Validation gate — format only.** `sanitizeCandidates` accepts any `^\d+(\.\d+)?$` amount
  (`merge-sanitize.ts:16`, `:23-30`). `9999999` kcal/100g passes.
- **Database constraint — sign only.** `food_nutrients_amount_nonneg` is `amount >= 0` (`schema/food.ts:227`).
  No upper bound anywhere in either schema.
- **Approval step — none.** `mergeChangedSources` writes automatically from the change-refresh scan
  (`worker/change-refresh/change-refresh.consumer.ts`; `merge-and-persist.service.ts:165-255`).
- **Anomaly check — none.** There is no prior value to compare against: `food_nutrients` is overwritten in place
  and there is no history table in the food schema.
- **Quarantine / rollback — none.** The admin surface is read-only except `POST /:id/refetch`
  (`foods/admin/foods-admin.controller.ts:29`, `:37`; `foods.controller.ts:137`), which re-pulls from the source
  that supplied the bad value.
- **Propagation signal — deliberately absent.** The `FoodFetchCompleted` EventBridge rule was removed and a test
  _asserts_ its absence (`infra/__tests__/food-service-stack.test.ts:394-402`).

Four containment measures, ordered by cost-effectiveness. **(1) and (2) are required with this delta; (3) and (4)
are the real price of D-LIVE and should be planned, not slipped.**

**1. Physical bounds on the recipe-side projection — the gate that actually fires.** These are not heuristics:
grams-per-100-grams cannot exceed 100 by definition of mass, and the caloric ceiling of any edible substance is
pure fat at ~884 kcal/100g. A kJ energy value for the same substance is ~3,700 — a factor of 3.7 clear of the
bound, so the kcal/kJ class becomes a loud constraint violation instead of a silent ×4.184.

```sql
ALTER TABLE ingredients ADD CONSTRAINT ingredients_nutrition_bounds CHECK (
    (calories_per_100g  IS NULL OR (calories_per_100g  >= 0 AND calories_per_100g  <= 1000)) AND
    (protein_g_per_100g IS NULL OR (protein_g_per_100g >= 0 AND protein_g_per_100g <= 100))  AND
    (carbs_g_per_100g   IS NULL OR (carbs_g_per_100g   >= 0 AND carbs_g_per_100g   <= 100))  AND
    (fat_g_per_100g     IS NULL OR (fat_g_per_100g     >= 0 AND fat_g_per_100g     <= 100))
) NOT VALID;

ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_user_nutrition_bounds CHECK (
    (user_calories  IS NULL OR user_calories  >= 0) AND
    (user_protein_g IS NULL OR user_protein_g >= 0) AND
    (user_carbs_g   IS NULL OR user_carbs_g   >= 0) AND
    (user_fat_g     IS NULL OR user_fat_g     >= 0)
) NOT VALID;
```

1000 rather than 900 on calories: headroom for legitimate fibre/polyol accounting variance, still 3.7× below the kJ
value. The `recipe_ingredients` bound is sign-only because those are absolute per-line values a user typed, not
per-100g ratios — there is no physical ceiling.

The constraint is a **backstop, not the mechanism**: a violation here is a 500 to a user, so the recipe service must
also reject the value at the boundary (the L2 whitelist) and report it as a modelled failure. A CHECK you rely on
for UX is a CHECK you have mis-sited; a CHECK you rely on to stop corruption is correctly sited.

**2. Deterministic selection.** L1 + L2 above. Without them the bounds fire on legitimate data (a kJ row) rather
than on corrupt data.

**3. Append-only nutrient history — the enabler for everything else.** Under a live reference the history table
**is** the audit trail; it is the price of the ruling, not an optional extra. Written inside
`mergeChangedSources`'s existing transaction (`merge-and-persist.service.ts:167-255`), so it cannot diverge:

```sql
CREATE TABLE food_nutrient_history (
    id          text PRIMARY KEY,
    food_id     text NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    nutrient_id text NOT NULL REFERENCES nutrient(id),
    amount      numeric NOT NULL,
    basis       nutrient_basis NOT NULL,
    source_id   text NOT NULL,          -- NOT the composite provenance FK: a source row may later be replaced,
                                        -- and history must survive that (see note below)
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT food_nutrient_history_amount_nonneg CHECK (amount >= 0)
);
CREATE INDEX idx_food_nutrient_history_food_recorded
    ON food_nutrient_history (food_id, nutrient_id, recorded_at DESC);
```

Two deliberate divergences from `food_nutrients`: **no** composite same-food provenance FK (`schema/food.ts:228-232`)
because history must outlive the crosswalk row it references, and **no** `UNIQUE(food_id, nutrient_id)` because
append-only is the point. Write a row only when the amount actually changes — USDA refreshes are low-frequency, so
volume is bounded by real change, not by scan frequency. Retention must be decided in the creating migration
(open decision C-6); an unbounded history is the accumulation problem relocated.

**4. A magnitude delta gate in `mergeChangedSources`.** With (3) in place: if a refreshed nutrient differs from the
stored value by more than an agreed factor, do not write it silently — hold the food at its current values, record
the attempted write, and alarm. This is the only measure that catches a _plausible-but-wrong_ revision (a 2× calorie
error is inside every physical bound). It is genuinely new machinery — a quarantine path, an operator surface, and
an alarm — and it should be planned as such rather than assumed.

**Approval step: no.** A human gate on automated USDA refreshes does not scale, there is no admin write surface to
host it, and it would make the catalogue stale in exactly the way D-LIVE rejects. The delta gate is the automated
substitute.

---

## Migration plan

**Two runner facts govern every migration below, and one of them was listed as "not examined" in the prior review.**

1. **Each migration file is applied inside an explicit transaction** — `client.query('BEGIN')`, the whole file as
   one `client.query(sql)`, `INSERT INTO schema_migrations`, `COMMIT`
   (`packages/services/recipe-service/src/lambdas/migrate/handler.ts:114-119`; identical in
   `food-service/src/lambdas/migrate/handler.ts:121-126`). Therefore:
    - **`CREATE INDEX CONCURRENTLY` cannot be used.** Every `CONCURRENTLY` recommendation in `09-data-model.md`
      (F-DB10, F-DB12, F-DB15) is **unshippable through this runner** and must be rewritten as a plain `CREATE INDEX`
      or moved to an out-of-band operational task. The repo already knows this and says so:
      `0004_food_name_trgm_gist.sql:42-45` — _"`CREATE INDEX` (not CONCURRENTLY) because the runner applies each file
      as one statement in a transaction"_.
    - **`ADD CONSTRAINT … NOT VALID` and `VALIDATE CONSTRAINT` must be in _different files_.** In one file they share
      a transaction, so the `ACCESS EXCLUSIVE` lock taken by the `ADD` is held across the validation scan and the
      split buys nothing. Across files the runner commits between them, and `VALIDATE` then takes only
      `SHARE UPDATE EXCLUSIVE` — concurrent reads and writes proceed.
    - **`ALTER TYPE … ADD VALUE` must be alone in its file.** PG 16 permits it inside a transaction block but forbids
      _using_ the new value until that transaction commits.
2. **`ADD COLUMN … NOT NULL DEFAULT <non-volatile>` is metadata-only on PG 11+** — no table rewrite. `now()` is
   STABLE (transaction start time), so it qualifies; `clock_timestamp()` is VOLATILE and would force a rewrite. The
   repo already relies on this (`0010_ratings_difficulty_cover.sql:16-18`).

**Blast-radius note.** The recipe service has **no production deployment** today, so these migrations currently run
only against sandbox and per-PR databases, which are small. The online-safety machinery below is designed for the
prod deploy that will exist; it is not theatre, but the present risk is bounded and should be recorded as such.

### Recipe service (head `0018` → `0024`)

| #   | File                                        | Shape                                                                                                                                                                                                                                                                                                                                       | Online safety                                                                                     | Reversible?                                                                                                                                                                                                      | Existing seeded rows                                                                                                                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `0019_ingredient_nutrition_bounds.sql`      | repair `UPDATE`s, then `ingredients_nutrition_bounds` + `recipe_ingredients_user_nutrition_bounds`, both `NOT VALID`                                                                                                                                                                                                                        | `ACCESS EXCLUSIVE` for a metadata-only catalog write; no scan                                     | yes — `DROP CONSTRAINT`                                                                                                                                                                                          | **may reject.** Count first (query below); a violating row means the kcal/kJ defect already fired                                                                                                                 |
| R2  | `0020_validate_nutrition_bounds.sql`        | `VALIDATE CONSTRAINT` ×2                                                                                                                                                                                                                                                                                                                    | `SHARE UPDATE EXCLUSIVE`; reads+writes proceed                                                    | yes                                                                                                                                                                                                              | fails loudly if R1's repair was incomplete — the desired behaviour                                                                                                                                                |
| R3  | `0021_ingredient_placeholder_coherence.sql` | F-DB3 repair + `ingredients_backing_coherent` `NOT VALID`                                                                                                                                                                                                                                                                                   | as R1                                                                                             | yes                                                                                                                                                                                                              | **must inspect, not auto-delete**, any `food_id IS NULL AND is_user_entered = false` row                                                                                                                          |
| R4  | `0022_validate_placeholder_coherence.sql`   | `VALIDATE CONSTRAINT`                                                                                                                                                                                                                                                                                                                       | as R2                                                                                             | yes                                                                                                                                                                                                              | —                                                                                                                                                                                                                 |
| R5  | `0023_ingredient_resolution_freshness.sql`  | `ADD COLUMN status_updated_at timestamptz NOT NULL DEFAULT now()`, `resolved_at timestamptz`, `food_updated_at timestamptz`, `resolution_sequence bigint NOT NULL DEFAULT 0`; `CREATE INDEX idx_ingredients_unresolved ON ingredients (food_resolution_status, status_updated_at) WHERE food_resolution_status IN ('PENDING','UNRESOLVED')` | all metadata-only; the index is partial and tiny (a healthy catalog is overwhelmingly `RESOLVED`) | yes — `DROP COLUMN`/`DROP INDEX`                                                                                                                                                                                 | safe: every default is constant/non-volatile. `status_updated_at` backfills to migration time, which **overstates freshness** for pre-existing rows — record that, or backfill from `created_at` in the same file |
| R6  | `0024_drop_lead_calories.sql`               | `ALTER TABLE recipes DROP COLUMN lead_calories_per_serving`                                                                                                                                                                                                                                                                                 | brief `ACCESS EXCLUSIVE`, no rewrite                                                              | **column yes, values no** — but the values are _derived_, so a revert re-adds the column NULL and the next write recomputes (exactly `0012`'s own shipped behaviour, `0012_lead_calories_per_serving.sql:12-16`) | column is NULL on any row not written since `0012`                                                                                                                                                                |

**R6 is expand-contract and MUST NOT ship in one release.** Order: (i) deploy the read-time fold and stop reading
the column in `search.dal.ts:82,149,201`; (ii) verify in sandbox; (iii) then R6. A single-release drop breaks every
list read on the old task during a rolling deploy. R6 is additionally gated on the measurement below.

**Prerequisite counts (read-only; run before writing R1/R3 — I did not run them):**

```sql
SELECT count(*) FROM ingredients
 WHERE calories_per_100g > 1000 OR protein_g_per_100g > 100
    OR carbs_g_per_100g > 100 OR fat_g_per_100g > 100;               -- R1 blockers
SELECT count(*) FILTER (WHERE food_id IS NOT NULL AND food_resolution_status IS NULL) AS no_status,
       count(*) FILTER (WHERE food_id IS NOT NULL AND is_user_entered)               AS both,
       count(*) FILTER (WHERE food_id IS NULL AND food_resolution_status IS NOT NULL) AS orphan_status,
       count(*) FILTER (WHERE food_id IS NULL AND NOT is_user_entered)                AS neither
  FROM ingredients;                                                   -- R3 blockers
```

Also re-run `packages/services/recipe-service/src/database/seed.ts` and the `__fixtures__` factories against R1/R3:
`09-data-model.md`'s "Not examined" flagged that adding these constraints **may break seeds**, and that is still
unchecked.

### Food service (head `0004` → `0008`)

| #   | File                                     | Shape                                                                                                                                                   | Online safety                                                                                    | Reversible?        | Existing rows                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------- |
| F1  | `0005_food_shell_lifecycle.sql`          | `ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0`; `food_terminal_tombstone_coherent` + `food_consecutive_failures_nonneg`, both `NOT VALID` | metadata-only + catalog writes                                                                   | yes                | column safe; the coherence CHECK **may reject** — count first |
| F2  | `0006_validate_food_shell_lifecycle.sql` | `VALIDATE CONSTRAINT` ×2                                                                                                                                | `SHARE UPDATE EXCLUSIVE`                                                                         | yes                | —                                                             |
| F3  | `0007_food_nutrient_history.sql`         | `CREATE TABLE` + index                                                                                                                                  | new table, no lock on existing tables                                                            | yes — `DROP TABLE` | none                                                          |
| F4  | `0008_food_shell_access_paths.sql`       | replace `food_status_idx` with two partials (F-DB15)                                                                                                    | plain `CREATE INDEX` takes a write lock — sub-second at current scale per `0004`'s measured note | yes                | **GATED ON MEASUREMENT**                                      |

Prerequisite count for F1:
`SELECT count(*) FROM food WHERE (status IN ('NOT_FOUND','FAILED')) <> (tombstoned_at IS NOT NULL);`

**Rollback posture, per the standing rule.** Every file above is reversible by a companion `DOWN` statement listed in
its header comment (this repo has no down-migration runner, so the reversal is an operator-applied statement, and it
must be _written_ even though it is not automated). The only genuinely irreversible action in this whole delta is
`ALTER TYPE … ADD VALUE`, which is why `ABANDONED` is deferred rather than bundled. **A backup and a rehearsed
restore are prerequisites for R1/R3/F1** — those three add constraints over existing rows.

---

## Measurement gate

`09-data-model.md` F-DB12 and F-DB15 recommended two `DROP INDEX`es on reasoning alone and said so; this section is
the discharge. **No index change and no denormalization change in this delta ships without the runs below.** The
model is the repo's own precedent, `packages/services/food-service/tests/food-search-access-path.integration.test.ts`,
which is the best measurement artifact in the codebase and whose three hard-won lessons bind here:

- **Production-shaped data or nothing.** That suite measured the natural plan flipping with table size — Seq Scan at
  6,000 rows, trigram BitmapOr at 12,000, Seq Scan again at 25,000, BitmapOr at 50,000. A plan captured on a small
  seed is noise.
- **Local milliseconds do not gate.** The workstation measured ~4.4× faster than CI (45.8 ms local against ~200 ms of
  a 209.9 ms CI p95). Latency contracts live in `tests/load/*.js` (heavy tier), not in a local number.
- **Do not encode a plan-shape assertion for a statement with an unstable natural plan.** That suite wrote, measured
  and then _removed_ a cost gate, and says so, because forcing the planner with `enable_seqscan=off` did not recover
  discrimination. Assert **equivalence** (identical result sequence with access paths disabled) plus a **vacuity
  guard** (the two runs really got different plans, and the index-side plan really named the index).

### Required runs

| Change                                                                          | Statement to plan                                                                                                                                                                                                                                                                                                  | Runs                                                                                                                                      | Ship condition                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R6 — drop `lead_calories_per_serving`**                                       | the search/list CTE at `search/dal/search.dal.ts` (the `RECIPE_COLUMNS` projection, `:79-83`), **plus** the two fold queries `SELECT … FROM recipe_ingredients WHERE recipe_id = ANY($1)` and `IngredientsDal.findByIds`                                                                                           | `EXPLAIN (ANALYZE, BUFFERS)` on all three, before and after, at production-shaped recipe/ingredient counts, for both browse and FTS modes | total wall time and **shared-buffer reads** of (list + 2 folds) within the agreed budget of today's single-query list. If not, take flip (c) — do **not** drop and hope |
| **F-DB12 — `DROP idx_recipes_visibility`, reshape `idx_recipes_public_recent`** | the public-feed read composed at `recipes/dal/recipe-predicates.ts:59-61`                                                                                                                                                                                                                                          | before/after plans; confirm the planner never chose `idx_recipes_visibility` (a 2-value btree) and that the reshaped partial is chosen    | the dropped index appears in **no** captured plan, and the reshaped index reduces heap-recheck rows                                                                     |
| **F-DB15 — `DROP food_status_idx`, add two partials**                           | the F1 orphan-shell sweep predicate, the `status IN ('PENDING','UNRESOLVED')` scan, and the TTL reactivation predicate at `food.dao.ts:256-266`                                                                                                                                                                    | before/after on a bulk-seeded store (the 50,000-food shape `0004` used)                                                                   | each of the three predicates gets an index scan on a partial index, and `food_status_idx` appears in none                                                               |
| **R5 — `idx_ingredients_unresolved`**                                           | "which of my ingredients are still unresolved"                                                                                                                                                                                                                                                                     | after-only plan proving an index scan on the partial, plus its size vs. a full index on the same columns                                  | partial is chosen and is materially smaller                                                                                                                             |
| **L2 whitelist**                                                                | not a plan — a **data** run: `SELECT DISTINCT name, unit FROM nutrient ORDER BY 1,2` and, per whitelisted macro, `SELECT count(*) FROM food f WHERE f.status='RESOLVED' AND NOT EXISTS (SELECT 1 FROM food_nutrients fn JOIN nutrient n ON n.id=fn.nutrient_id WHERE fn.food_id=f.id AND n.name=$1 AND n.unit=$2)` | on a bulk-seeded store                                                                                                                    | the "no match" count is not materially worse than today's substring match — otherwise the whitelist is incomplete, not the data                                         |
| **Shell-fraction trigger**                                                      | `SELECT count(*) FILTER (WHERE status <> 'RESOLVED')::float / count(*) FROM food`                                                                                                                                                                                                                                  | recorded as an ongoing metric                                                                                                             | crossing the agreed threshold re-opens `0004`'s partial-index decision                                                                                                  |

**Where these live.** Each gets an `*.integration.test.ts` beside the existing access-path suite (food) or a new one
in `packages/services/recipe-service/tests/` (recipe), asserting **equivalence + vacuity**, never a millisecond
threshold. Latency belongs to the heavy-tier k6 scripts. Per the standing testing policy every change in this
document also owes unit **and** integration tests, and both services owe e2e + k6.

---

## Open decisions for ce-plan

Each carries my recommendation and the condition that flips it. C-1/C-2 gate the delta; the rest gate later work.

- **C-1 — `lead_calories_per_serving`: drop, or declared as-of cache?** _Recommend drop (a)_, with (c) as the
  measured fallback. **Flip if** the R6 measurement shows the two fold queries cost more than the agreed budget —
  in which case (c) **must** expose `leadCaloriesAsOf` on the wire.
- **C-2 — Does the wire change for the account export ship with the drop?** `leadCaloriesPerServing` moves from a
  stored numeric-as-string to a computed number in `packages/schemas/recipe`. _Recommend yes, in the same release_ —
  shipping the drop without it leaves the export reading a column that no longer exists. One-way door under ADR-0014.
- **C-3 — Does `nutrition_compliance` carry a full input snapshot or only `source_digest`?** _Recommend digest only._
  **Flip if** a rectification or trainer-accountability requirement demands reconstructing the meal, in which case it
  is a `nutrition_compliance_inputs` child table with its own retention, decided before the table exists.
- **C-4 — A sixth `food_status` (`ABANDONED`)?** _Recommend no for now_; `consecutive_failures` + backoff delivers the
  behaviour. **Flip if** the product wants to tell a user "this will never resolve" in distinct words. Costed above;
  irreversible enum change; the `foodStatusSchema` partition test makes deferring safe.
- **C-5 — What does a terminal-then-reactivated food mean to a recipe that recorded the terminal state?** Unresolved
  (15/A-4(i)). Two coherent answers: the recipe-side terminal row stores a tombstone anchor and is re-checkable, or
  reactivation mints a **new** food id. _No recommendation_ — it is a product+contract decision, and it is the one
  place where "the id means the same thing forever" is currently violated.
- **C-6 — `food_nutrient_history` retention.** _Recommend deciding it in the creating migration_ (the D-9 rule), not
  after. Under D-LIVE this table is the rectification record, so retention is a privacy decision as much as a storage
  one — route it past `dpo-1`.
- **C-7 — Does the magnitude delta gate ship with this delta or after?** _Recommend after, but planned now_, because
  it needs a quarantine surface and an alarm that do not exist. **Say plainly in the plan that until it ships, the
  only containment is the physical bounds** — which catch the ×4.184 class and nothing subtler.
- **C-8 — Does `GET /ingredients/{id}/status` stop being the write path?** Carried from 16/A-1 and not resolved here.
  It remains the case that an unthrottled GET by any authenticated user rewrites a shared row for every recipe on the
  platform. A schema delta cannot fix that; it is a routing/eventing decision (`staff-architect`).

---

## Not examined

Stated explicitly so absence is not read as clearance.

- **No database was connected to and no query was executed.** Every plan claim is deferred to the Measurement gate
  rather than asserted. No `EXPLAIN`, no `pg_stat_statements`, no table or index sizes, no row counts. The
  prerequisite counts in the Migration plan are written but **not run**.
- **The seeded local databases** (`kitchensink_recipes`, `kitchensink_identity`, `food_e2e`) were not inspected, per
  the safety directive. Whether existing rows violate R1/R3/F1 is therefore **unknown**, and taking those counts is a
  prerequisite to writing any of the three.
- **`database/seed.ts` and the `__fixtures__` factories** were not audited against the new constraints. `09-data-model.md`
  flagged this and it remains open — adding these constraints may break seeds and fixture builders.
- **`recipe_versions.snapshot`** (`schema/versions.ts:53`) — the JSONB version snapshot may embed
  `leadCaloriesPerServing`. If it does, R6 has a consequence for version restore that I did not trace.
- **The `mergeChangedSources` blend semantics** (`foods/merge/merge-engine.ts`) — I verified that
  `sanitizeCandidates` _can_ drop a nutrient (the storage consequence) but not _how often_ the blend actually loses
  one. That sets the real-world frequency of the COALESCE-accumulation defect, not its existence.
- **006's meal-plan-service schema** — it has none yet, and the carve-out above is deliberately independent of it,
  but the rollup's cross-service read shape is `staff-architect` work under the ADR-0017 amendment.
- **007 (grocery lists)** and **005 (AI)** — neither was read for stability assumptions about nutrition. Only 006 and
  009 were examined here, and 009 only for `nutrition_compliance`.
- **The identity schema** and `packages/shared/identity-db` — not read.
- **Client/UI polling behaviour** — how often and for which statuses web and mobile call `GET /:id/status`. This sets
  the real exposure of C-8 and of the freshness of "live" nutrition in practice.
- **Whether any of this is already covered by an ADR.** `docs/architecture/decisions/` was not enumerated in this
  pass; D-LIVE and D-SHELL both need one and I am assuming none exists.

---

**Confidence: High** on everything read from source — the runner's per-file transaction
(`handler.ts:114-119`), the universally-null `external_code` (four producer call sites), the missing `ORDER BY`
(`food.dao.ts:436-447`), the `COALESCE` accumulation (`ingredients.dal.ts:373-378`), the three write-only call sites
for `lead_calories_per_serving`, the absence of any `DELETE FROM food`, and the format-only merge sanitization.
**Medium** on the two reversals (⟲): the `external_code` reversal is a fact, but "populate it from FDC
`nutrient.number`" is a design suggestion I did not validate against the bulk parser's columns; the no-delete
reversal rests on a reachability argument about un-re-polled `RESOLVED` rows, not on an observed incident.
**Low, and gated accordingly**, on every index and denormalization cost claim — hence the Measurement gate.

**Sources inspected**: `recipe-service/src/database/schema/{ingredients,recipes}.ts`;
`recipe-service/src/database/migrations/{0010,0012,0018}*.sql` (full) and the directory listing (head `0018`);
`recipe-service/src/ingredients/{ingredients.service.ts,ingredients.controller.ts,dal/ingredients.dal.ts}`;
`recipe-service/src/recipes/recipes.service.ts` (§ nutrition + the three lead-calorie call sites);
`recipe-service/src/search/dal/search.dal.ts`; `recipe-service/src/account/{export.mappers.ts,account.schema.ts}`;
`recipe-service/src/lambdas/migrate/handler.ts`; `packages/shared/recipe-core/src/nutrition.ts`;
`food-service/src/db/schema/{food,operational}.ts`;
`food-service/src/db/migrations/0004_food_name_trgm_gist.sql`;
`food-service/src/foods/dao/{food.dao.ts,food-candidates.dao.ts}`;
`food-service/src/foods/merge/{merge-sanitize.ts,merge-and-persist.service.ts}`;
`food-service/src/sources/usda/{usda.adapter.ts,bulk/usda-bulk.parser.ts}`;
`food-service/src/lambdas/migrate/handler.ts`;
`food-service/tests/food-search-access-path.integration.test.ts`;
`packages/schemas/food/src/schemas/foods.schema.ts`; `specs/009-nutrition-planning/plan.md` §2;
and reports `09`, `12`, `15`, `16` in this directory.

**Recommended follow-on agents**: `be-1` for the `updateResolution` typed-observation refactor, the L2 whitelist, and
the constraint migrations; `per-1` to execute the Measurement gate before R6/F-DB12/F-DB15 ship; `staff-architect`
for C-5 (id semantics across reactivation) and C-8 (write-on-GET); `dpo-1` for C-6 (history retention) and the 009
carve-out's Art. 16/17 posture; `sre-1` for the shell-fraction metric and the delta-gate alarm.
