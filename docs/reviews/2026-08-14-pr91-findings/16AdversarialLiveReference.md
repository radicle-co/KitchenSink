# 16 — Adversarial: "recipe nutrition is a LIVE REFERENCE, not a snapshot"

**Decision under attack** (owner ruling, 2026-08-14): a recipe's ingredient points at a shared, ownerless
food catalog row, and the recipe always reflects that row's CURRENT nutrition. USDA refresh and third-party
disambiguation change every referencing recipe retroactively. A pinned snapshot with an as-of timestamp was
explicitly rejected.

**Bottom line up front.** The decision as a _product philosophy_ is defensible — 006 already reasoned its way
to the same answer independently and recorded it. But **the system does not implement the decision.** It
implements a third thing that is neither live nor pinned: a per-field, monotonically-accumulating cache that
is only refreshed when an arbitrary user happens to hit a `GET`, sitting underneath a stale denormalized copy
that nothing ever recomputes. Five of the six attacks below land. The decision can stand; the implementation
cannot stand as-is.

---

## A-1 — Blast radius: one bad catalog write corrupts every referencing recipe, with no signal, no audit, and no reversal

**Claim attacked.** "The recipe always reflects the catalog row's CURRENT nutrition" — i.e. propagation is a
property of the design, and therefore presumed to be safe/observable.

**Attack.** Trace the propagation path end to end and ask three questions: (a) how does a food-service change
actually reach a recipe; (b) can an operator _detect_ a bad value; (c) can an operator _reverse_ it.

**Evidence.**

_(a) There is no push. The only propagation path is a `GET` that writes._

`mergeChangedSources` rewrites the golden record in one transaction and emits a completion event:

- `packages/services/food-service/src/foods/merge/merge-and-persist.service.ts:165-255` — upserts nutrient
  amounts (step 4, lines 223-240), replaces portions (step 5), bumps `updated_at` (step 6).
- `packages/services/food-service/src/worker/food-consumer.service.ts:370-375` — `mergeChangedSources(...)`
  then `publishFoodFetchCompleted({ id: foodId, status: 'RESOLVED' })`.

That event has **no subscriber, by construction**:

- `packages/services/food-service/infra/lib/food-service-stack.ts:263` — the comment states the event "is
  still emitted as part of the event contract for **future consumers**".
- `packages/services/food-service/infra/__tests__/food-service-stack.test.ts:394-402` — a test _asserts_ the
  rule is absent: `"keeps the FoodEventBus but drops the now-consumer-less FoodFetchCompleted rule"`.

So recipe-service learns nothing. The **only** path by which a food change reaches `ingredients` is:

- `packages/services/recipe-service/src/ingredients/ingredients.controller.ts:266-273` —
  `GET /api/v1/ingredients/{id}/status` → `refreshStatus`.
- `packages/services/recipe-service/src/ingredients/ingredients.service.ts:403-411` — reads
  `getStatus`, then **writes** `updateResolution(... extractNutrition(resolved), extractPortions(resolved))`.

Two consequences the decision statement does not acknowledge:

1. **A `GET` performs an unauthenticated-in-intent write to a shared, ownerless row.** Any authenticated user
   who polls any ingredient id rewrites nutrition for **every** recipe in the system that references it. The
   controller docstring at `ingredients.controller.ts:258-259` explicitly removes the throttle: _"NO throttle
   decorator: this GET is a client-driven poll, so it inherits the generous read limit."_ There is no owner
   check (`@OwnerId() _ownerId` is an auth assertion only, `ingredients.controller.ts:268`), and there is no
   guard on `foodResolutionStatus === RESOLVED` in `refreshStatus` (contrast `resolve`, which _is_
   converge-only at `ingredients.service.ts:484-486`).
2. **Nutrition is therefore not "current".** It is whatever the last arbitrary poller observed. A recipe whose
   ingredient nobody polls keeps a value from months ago. A recipe whose ingredient a stranger polls one second
   after a bad USDA refresh gets the bad value. Freshness is a function of unrelated user traffic.

_(b) The refresh does not replace nutrition — it accumulates it, per field._

`extractNutrition` returns `undefined` for any macro whose name does not match
(`ingredients.service.ts:127-136`). `updateResolution` then coalesces:

```
calories_per_100g  = COALESCE(${calories}, calories_per_100g),
protein_g_per_100g = COALESCE(${protein}, protein_g_per_100g),
```

— `packages/services/recipe-service/src/ingredients/dal/ingredients.dal.ts:373-378`.

So if a refreshed golden record **loses** a nutrient (source drops it, the `sanitizeCandidates` blend excludes
it, the changed item no longer supplies it), the old value **survives**. `mergeChangedSources` never deletes
`food_nutrients` rows either — step 4 only upserts (`merge-and-persist.service.ts:223-240`). The result is a
row whose calories came from the 2026 refresh and whose protein came from the 2024 fetch. **That is neither a
live reference nor a snapshot.** It is a Frankenstein record with no as-of basis for any single field, and the
decision statement's semantics ("the row's CURRENT nutrition") are simply not what the code produces.

_(c) The kcal/kJ hazard is not a static bug — the live reference makes it non-deterministic across time._

The nutrient dictionary is keyed `UNIQUE(name, unit)`
(`packages/services/food-service/src/db/schema/food.ts:191`), so USDA's two `Energy` rows (kcal and kJ) are
**two distinct `nutrient` rows**, and `food_nutrients` is `UNIQUE(food_id, nutrient_id)`
(`food.ts:226`) — so a single food legitimately holds **both**, both `basis = 'per_100g'`.

The golden-record read has **no `ORDER BY`**:
`packages/services/food-service/src/foods/dao/food.dao.ts:434-447`.

The recipe side picks the **first** name-substring match and **ignores `unit`**:
`ingredients.service.ts:65` (`nutrients.find((n) => n.basis === 'per_100g' && matches(...))`) and
`:131` (`name.includes('energy') || name.includes('calorie')`). The `unit` field **is on the wire and is
available** — `packages/schemas/food/src/schemas/foods.schema.ts:82-83` — it is simply not consulted.

Under an unordered sequential scan Postgres returns physical heap order. `upsertValue` during a refresh writes
a new tuple version, which relocates that row in the heap. **A refresh that changes nothing about energy can
therefore flip which `Energy` row is returned first**, silently multiplying or dividing every referencing
recipe's calories by ~4.184. Under a snapshot this is a one-time write bug caught at authoring time; under a
live reference it is a value that can flip _after_ the user has seen and trusted it.

_(d) No audit trail, no reversal._

- `food_nutrients` is one row per `(food_id, nutrient_id)`, overwritten in place (`food.ts:211-236`). There is
  **no history/version/audit table anywhere in the food schema** (`src/db/schema/*.ts` — `food.ts`,
  `operational.ts`, `food-candidates.ts`; the only `_log` is `source_call_log`, a rate-limit window).
- `food_sources.item_version` / `fetched_at` are themselves upserted forward
  (`merge-and-persist.service.ts:176-184`), so the prior version is gone too.
- `ingredients` has no `updated_at`, no `resolved_at`, no version column
  (`packages/services/recipe-service/src/database/schema/ingredients.ts:48-88` — `created_at` only).
- The food admin surface is **read-only**: `GET metrics`, `GET queue`
  (`packages/services/food-service/src/foods/admin/foods-admin.controller.ts:29,37`). The only mutating admin
  action is `POST /api/v1/foods/{id}/refetch` (`foods.controller.ts:137`), which re-pulls from **the same
  upstream that supplied the bad value**.

**Verdict: SURVIVES — the attack lands in full.** A single bad catalog write silently corrupts every
referencing recipe, retroactively, with (i) no propagation signal, (ii) no record of what the value was
before, (iii) no timestamp saying when it changed, and (iv) no operator mechanism to detect or reverse it.
The only available remediation is "re-fetch from the source that was wrong."

**What must change.**

1. `nutrientPer100g` must match on `(name, unit)` — reject a `kJ` energy row, or convert it explicitly. Add an
   `ORDER BY` to the golden-record nutrient select so the read is deterministic regardless.
2. `updateResolution` must **replace**, not `COALESCE`, the nutrition block on a `RESOLVED` observation — an
   absent macro must NULL the column, so a row's four macros always share one as-of basis.
3. Add `resolved_at` (and ideally `food_updated_at`) to `ingredients`. Without it there is literally no way to
   answer "when did this recipe's calories last change, and to what."
4. `GET /:id/status` must stop being the write path, or must be constrained: no-op when already `RESOLVED`
   (matching `resolve`'s converge-only guard), with refresh moved to a signalled, audited path.
5. Append-only `food_nutrient_history` (or a temporal table) on the food side. Under a live reference, the
   history table _is_ the audit trail — it is the price of the decision, not an optional extra.

---

## A-2 — The denormalized copy: the system has a live reference AND a stale snapshot simultaneously

**Claim attacked.** That "live reference" describes the system's behaviour — i.e. that there is one answer to
"what are this recipe's calories."

**Attack.** Find every write to `recipes.lead_calories_per_serving` and check whether any catalog change
recomputes it.

**Evidence.**

`leadCaloriesFor` has exactly three call sites, all write-time:

- `packages/services/recipe-service/src/recipes/recipes.service.ts:488` (create)
- `:649` (update)
- `:779` (clone)

Update is further gated: `const recomputeLead = ingredients !== undefined || dto.servings !== undefined;`
(`recipes.service.ts:647`) — so editing a recipe's _title_ leaves the stored calories untouched.

Nothing in the ingredient/food path touches it. `refreshStatus` writes `ingredients` only
(`ingredients.service.ts:406-411`); `mergeChangedSources` never crosses the service boundary; the
`FoodFetchCompleted` rule is deleted (A-1).

Meanwhile the two read paths diverge structurally:

- **Detail** computes live from the catalog: `computeDetailNutrition` → `assembleNutritionLines` →
  `this.ingredientsDal.findByIds(ids)` (`recipes.service.ts:365-386`).
- **List / search / collection-embed** read the frozen column:
  `packages/services/recipe-service/src/search/dal/search.dal.ts:82,149,201`.

So the same recipe reports calories from **two different points in time** — the card from its last write, the
detail from the last time somebody polled the ingredient. This directly falsifies the load-bearing claim in
`packages/shared/recipe-core/src/nutrition.ts:66-69`:

> _"so a card's stored `leadCaloriesPerServing` and the detail's live `nutrition.calories` are computed from
> byte-identical inputs and **can never disagree**"_

They are computed from byte-identical inputs **at a single instant**. The comment mistakes "same pure function"
for "same value." The test that ostensibly guards this
(`packages/shared/recipe-core/src/__tests__/nutrition.test.ts:201-207`) calls both functions on one in-memory
array in one tick — it cannot fail if the catalog moves, so it is coverage theater with respect to the claim
it is cited for.

**This repo already holds itself to the opposite standard for the analogous field.** 001-FR-013a
(`specs/001-commise-recipe-app/spec.md:148`) requires the denormalized rating aggregate to be _"consistent with
the ratings it summarizes **at all times**"_ and that _"it MUST NOT be possible for a write path to bypass its
maintenance and leave it stale."_ That is enforced in the database — a statement-level trigger with transition
tables recomputing `average_rating`/`rating_count` on every INSERT/UPDATE/DELETE, plus a CHECK coherence
constraint (`src/database/migrations/0010_ratings_difficulty_cover.sql:90-124`, constraint at `:43`).
`lead_calories_per_serving` has **neither trigger nor constraint** — the migration
(`0012_lead_calories_per_serving.sql:13`) even records that it ships with no backfill and stays NULL until the
next write.

**Verdict: SURVIVES — this is the strongest finding in the review.** The owner chose live reference; the system
delivers live reference _and_ stale snapshot at once, which is strictly worse than either pure option, and the
codebase's own comment asserts the contradiction is impossible.

**What must change.** Pick one and enforce it:

- (a) **Drop the column** and compute the card's calories in the list query (the N+1 concern that motivated it
  is a `LATERAL`/join problem, not a denormalization problem); or
- (b) **Keep the column and make it maintained**, FR-013a-style: recompute every recipe referencing an
  ingredient whose nutrition changed, in the same transaction as the `ingredients` write, and add a coherence
  test that mutates the catalog and asserts card == detail (the current test cannot); or
- (c) **Keep the column and relabel it honestly** as an as-of value, exposing `leadCaloriesAsOf` on the wire —
  which is the rejected snapshot design, admitted for the card only.

At minimum, delete the "can never disagree" claim at `nutrition.ts:66-69`. It is false today and it will
mislead the next engineer into skipping exactly the invalidation this needs.

---

## A-3 — Is the decision implementable downstream? 006 defeats the attack; 009 does not

**Claim attacked.** That live reference composes cleanly with the aggregating features (006 meal plans, 009
nutrition planning).

**Attack.** Read 006 and 009 and determine whether either assumes stability.

**Evidence — 006: the attack FAILS, and cleanly.**

`specs/006-meal-planning/spec.md:345-347` anticipates this exact scenario and rules the same way the owner did,
with reasoning:

> _"**A recipe's nutrition changes after assignment.** Totals are computed at read time from current recipe
> nutrition, so the plan reflects the recipe as it is now. Nutrition is never snapshotted onto the entry — a
> snapshot would silently go stale and there is no requirement for historical fidelity."_

Reinforced by `spec.md:49-51` (C-006-003: aggregate from recipe-level nutrition, not from ingredients) and
`spec.md:397-402` (FR-024: read-time computation, `isComplete` propagates partial). 006 is a **forward-looking
plan**, so "as it is now" is the correct semantic — a meal plan for next Tuesday should use today's best
nutrition data. **006 independently reached the owner's ruling.** That is genuine corroboration and it should
be counted as such.

**Evidence — 009: the attack LANDS.**

009 persists computed nutrition into a table and derives a status from it:

```
nutrition_compliance (
  ... date DATE,
  planned_calories DECIMAL, ...
  actual_calories DECIMAL,     -- filled by 006 meal plan actuals
  ...
  compliance_status TEXT,     -- 'on_track' | 'over' | 'under'
  created_at TIMESTAMP
)
```

— `specs/009-nutrition-planning/plan.md:72-87`.

Written by an upsert on meal-plan mutation (`plan.md:365-379`) and by a **nightly compliance rollup** job
(`specs/009-nutrition-planning/spec.md:86`, `plan.md:140,275`). Note the table has `created_at` and **no
`as_of`, no `computed_at`, no input-version column** — the exact omission A-1 found on `ingredients`.

009 also computes compliance **live** on read: `GET /api/v1/nutrition-plans/{id}/compliance` returns
`actual` + `status` + `delta` (`plan.md:336-357`), and `compliance_status: calculateStatus(nutrition, targets)`
(`plan.md:377`). So 009 has **two answers to the same question** — the persisted row and the live computation —
which under a live reference will diverge the moment USDA refreshes.

The substantive problem is not the divergence, it is the semantics: `actual_*` is a record of **what the user
actually ate on a past date**. Under a live reference, a 2026-06-01 row that read `on_track` can silently
become `over` in August because USDA revised a chicken-breast entry. `plan.md:432` indexes
`nutrition_compliance(nutrition_plan_id, date)` — this is explicitly a time series of past days.

**006's own justification does not transfer.** 006 said _"there is no requirement for historical fidelity."_
For a forward plan that is true. For 009's `actual_*` past-date series, historical fidelity **is the entire
requirement** — that is what "actual" means. The two features are not making the same trade.

**Verdict: WEAKENED for 006 (attack defeated by an explicit, well-reasoned spec ruling); SURVIVES for 009.**
The decision is implementable, but it is not _uniformly_ correct across the feature set, and nothing currently
records where the boundary is.

**What must change.** Record the boundary explicitly, because it is the thing that will be lost:
**forward-looking projections (006 planner totals, recipe detail, cards) are live; recorded past outcomes (009
`nutrition_compliance.actual_*`, and any future consumption log) are pinned at record time.** Give
`nutrition_compliance` a `computed_at` and treat the row as immutable once its date has passed — a nightly
rollup must not rewrite a closed day. If 009 is instead meant to be fully live, then `nutrition_compliance`
should not exist as a persisted table at all and compliance should be computed on read only; either answer is
coherent, the current design is not.

---

## A-4 — Health-data angle: retroactive mutation of Article 9 data is an integrity/accountability problem, not a lawfulness one

**Claim attacked.** That retroactively rewriting recorded nutrition is compliance-neutral.

**Attack.** 009 classifies its data as GDPR Article 9 special-category health data
(`specs/009-nutrition-planning/plan.md:26-34,197,418`; `research.md:139-191`). Does silently mutating a
recorded value create a problem under that classification?

**Evidence.**

- Classification is asserted and reasoned, not hand-waved: `research.md:143` cites ICO/EDPB on dietary data tied
  to health goals; `plan.md:28` names it _"special category health data"_; `plan.md:167` and `tasks.md:163` make
  physical isolation of Article 9 data ADR-0017's recorded flip condition. The team already treats error
  messages as a disclosure surface for it (`tasks.md:173`).
- The **accuracy principle** (Art. 5(1)(d)) and the **accountability principle** (Art. 5(2)) are the ones in
  play, not Art. 9's lawful-basis conditions. Art. 9 governs _whether_ you may process; it does not itself
  require immutability. So the attack must be scoped honestly: **this is not "the decision is illegal."**
- The concrete exposures are:
    - **Art. 16 (rectification) / Art. 5(1)(d) accuracy.** A data subject who disputes a recorded value cannot be
      given an answer. There is no `computed_at` on `nutrition_compliance` (`plan.md:72-87`), no `resolved_at` on
      `ingredients` (`schema/ingredients.ts:48-88`), and no nutrient history in food (`food.ts:211-236`) — so the
      controller cannot state what the value was, when it changed, or why.
    - **Art. 5(2) accountability.** The trainer-client model (`spec.md:50` FR-038, `plan.md:88-95`
      `trainer_clients`) means a _second party_ sees a client's Article 9 data and may act on it. If a trainer's
      view of a past week changes between two sessions with no record of the change, neither party can
      reconstruct the basis of a decision. Consent is recorded (`research.md:434`); the _data the consent covered_
      is not.
    - **Art. 20 (portability).** The account export ships the stale denormalized copy verbatim —
      `packages/services/recipe-service/src/account/export.mappers.ts:60` exports
      `leadCaloriesPerServing` as the stored string, and `account.schema.ts:239` types it as such. So the exported
      figure is A-2's stale snapshot, not the value the user saw on the detail screen. Two "official" answers, one
      of them in the portability artifact.
- **Counter-evidence that partly blunts this.** The repo demonstrably knows how to build audit machinery when
  it decides the data warrants it: `0018_erasure_audit_trigger_source.sql` and `0005_account_erasure.sql`. So
  this is a gap in application to nutrition, not an institutional blind spot — and 009 is **not built**
  (`specs/006-meal-planning/spec.md:24` — _"Downstream — NOT BUILT"_), so nothing is currently in breach.

**Verdict: WEAKENED — real, but narrower than the attack line implies.** Retroactive mutation is not unlawful
under Art. 9 and there is no present violation because 009 does not exist. It _is_ an accuracy/accountability
defect that will become live the moment 009 ships, and the absence of any timestamp on the value makes it
unanswerable rather than merely inconvenient.

**What must change.** Before 009 ships: `nutrition_compliance.actual_*` rows must be immutable once their date
closes, carrying `computed_at`; a rectification path must be able to say what a value was and when it changed
(A-1's history table is the enabler); and the portability export must not ship a figure that disagrees with the
product UI (A-2).

---

## A-5 — Steelman the rejected option, and price the loss

**Claim attacked.** That the pinned snapshot with an as-of timestamp was correctly rejected.

**The strongest case for the snapshot.**

1. **This repo has already ruled the other way in an adjacent, better-analyzed case.** 001-FR-011
   (`specs/001-commise-recipe-app/spec.md:136`) governs collection cloning:

    > _"The clone is a snapshot at clone time... future changes to the source collection MUST NOT propagate
    > automatically... MUST expose a user-initiated 'Pull updates from source' action... opt-in per invocation."_

    That is **exactly** the rejected design — pin + explicit, user-initiated refresh — chosen for a case with
    _lower_ stakes than nutrition. A user's dinner macros are at least as deserving of "nothing changes under
    you without your say-so" as their collection membership.

2. **A snapshot converts every A-1 failure from silent to bounded.** kcal/kJ flip, the COALESCE Frankenstein,
   the unpolled-stale/stranger-polled-fresh asymmetry — all of them stop propagating retroactively. A bad
   catalog write poisons _new_ recipes; existing ones are untouched until their owner opts in. Blast radius
   goes from "every recipe in the system, silently" to "recipes authored during the bad window."
3. **An as-of timestamp is the audit trail, for free.** A-1's central failure is that no one can answer "what
   was this value, and when did it change." A pin answers it by construction, with no history table, no event
   bus, no trigger.
4. **It removes the A-2 contradiction outright.** With a pinned per-line snapshot, `lead_calories_per_serving`
   is genuinely correct and the "can never disagree" comment becomes true instead of false.
5. **Precision honesty.** A recipe's nutrition is _already_ an estimate (`nutrition.ts:12-16` — lines with
   non-convertible units are excluded and `isComplete` flips false). A number that silently changes is _less_
   trustworthy than a number labelled "as of 12 Mar 2026", because the user cannot tell the two apart.
6. **It is cheap.** `recipe_ingredients` already carries per-line denormalized columns for exactly this kind of
   pinning — `user_calories`, `user_protein_g`, `user_carbs_g`, `user_fat_g`, `ingredient_name`,
   `is_user_entered` (`schema/ingredients.ts:113-120`). Adding four `snapshot_*_per_100g` columns plus
   `nutrition_as_of` follows an established shape.

**What the owner loses by choosing live reference.**

| Lost                                                                                            | Severity                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| A recipe silently disagrees with itself over time (card vs detail vs export) until A-2 is fixed | High — currently shipping               |
| No answer to "what was this value before, and when did it change"                               | High — needs a history table to recover |
| A bad catalog write reaches every referencing recipe with no containment                        | High — needs detection/rollback tooling |
| 009's `actual_*` past-date series has no stable meaning                                         | High — needs A-3's boundary             |
| Users see numbers change with no explanation and no "why"                                       | Medium — needs a UI disclosure          |

**What the owner gains, and it is real.** No stale-data problem (006's stated reason, `spec.md:346`); USDA
corrections and community disambiguation improve every recipe at once; no per-recipe backfill migration when
the food model improves; one number, not two; and no storage/complexity cost for snapshot columns and refresh
UI. For a _forward-looking_ cooking app — which is what 006 correctly identified this as — that is the right
trade.

**Verdict: the decision SURVIVES as a philosophy; the rejection of the snapshot is DEFENSIBLE but
under-priced.** The owner is not wrong that live reference is the better default for recipes and meal plans.
The owner _is_ wrong if the ruling was made on the assumption that live reference is the cheaper option: it is
the option that requires **more** machinery (history, invalidation, detection, rollback, disclosure), not less,
and none of that machinery exists today. A snapshot would have been the cheap option.

**Is the loss acceptable?** Yes — **conditionally, and only for the forward-looking surfaces.** Live reference
for recipe detail, cards, and 006 planner totals is acceptable _once the guardrails below exist_. Live
reference for 009's recorded `actual_*` is **not** acceptable and should be carved out now, while it is free
to do so.

---

## A-6 — `addByName` writes a caller's raw typed string as the shared catalog's permanent global name

**Claim attacked.** That the live-reference model's shared, ownerless catalog is safe to have callers write to.

**Attack.** The ammunition flags `addByName` as writing the caller's raw string as a permanent global name. Under
a live reference this compounds: a bad name is not merely a bad label, it is the identity every future user
matches and disambiguates against. Verify, and check reconciliation.

**Evidence.**

`packages/services/recipe-service/src/ingredients/ingredients.service.ts:368-382`:

```
const trimmed = name.trim();
const added = await this.foodClients.standard(caller).addByName(trimmed);
...
return this.dal.createFoodBacked({ name: trimmed, foodId: added.id, ... });
```

The caller's own string becomes `ingredients.name` and seeds the FTS vector
(`dal/ingredients.dal.ts:330-332` — `to_tsvector('english', ${input.name})`).

It is **never reconciled**. `updateResolution` writes only status, four macros, and portions
(`ingredients.dal.ts:372-380`) — there is no `name = ...`. So when the food later resolves to a proper golden
record, the row keeps the typo, the abbreviation, or the profanity forever, for every user.

This is a **known, documented inconsistency in the same file.** `addByFoodId` refuses to do this, with an
explicit rationale at `ingredients.service.ts:257-262`:

> _"the name MUST come from food-service. Accepting a caller-supplied name would let any authenticated client
> attach an arbitrary label to a real food in a catalog that is ownerless and shared by every user (data-model
> R5) — **mislabeled nutrition for everyone**."_

`addByName` does precisely what that paragraph forbids, ~110 lines further down. The mitigation that makes the
`resolve` path safe (converge-only, `:484-486`) has no analogue for the name.

**Verdict: SURVIVES.** And it is worse under a live reference than under a snapshot: with a pin, a bad name is
attached to the recipes that chose it; with a live shared reference, the bad name is the global identity that
routes every future user's search and disambiguation to that row.

**What must change.** On the first `RESOLVED` observation, adopt the golden record's name (the value is already
in hand at `ingredients.service.ts:405`) and refresh `search_vector`. Keep the caller's string, if wanted, as a
per-recipe display alias on `recipe_ingredients.display_text`, which already exists
(`schema/ingredients.ts:109`) — that is where a user's own wording belongs.

---

## Guardrails required if this decision stands

Ordered by "what breaks first in production."

1. **Fix the unit-blind nutrient match before anything else.** Match `(name, unit)` in
   `nutrientPer100g` (`ingredients.service.ts:61-68,131`), and add a deterministic `ORDER BY` to the
   golden-record nutrient select (`food.dao.ts:434-447`). Today calories can be persisted in kJ, and under a
   live reference the selection can _flip_ on an unrelated refresh. This is a ~4.184x error in the headline
   number of a food app.
2. **Make `updateResolution` replace rather than accumulate.** Drop `COALESCE` for the four macro columns
   (`ingredients.dal.ts:373-378`) so a row's macros always share one as-of basis. Otherwise "current
   nutrition" is a claim the storage layer cannot honour.
3. **Resolve the A-2 contradiction — this is the blocker.** Either invalidate
   `recipes.lead_calories_per_serving` when catalog nutrition changes (FR-013a discipline: same transaction,
   plus a coherence test that _mutates the catalog_ and asserts card == detail), or delete the column. Delete
   the false "can never disagree" claim at `nutrition.ts:66-69` either way.
4. **Add `resolved_at` (and `food_updated_at`) to `ingredients`.** Without a timestamp the live reference is
   unauditable and unrectifiable by construction. This is the single cheapest change with the highest recovery
   value.
5. **Append-only nutrient history on the food side.** `food_nutrient_history` (or a temporal table) written in
   `mergeChangedSources`'s existing transaction (`merge-and-persist.service.ts:165-255`). Under a live
   reference, history _is_ the audit trail — it is the price of the ruling.
6. **Give an operator a containment and rollback path.** A bad USDA refresh currently has exactly one remedy:
   re-fetch from the same bad source (`foods.controller.ts:137`). Needed: a way to see what changed, quarantine
   a food, and restore a prior nutrient set from (5).
7. **Stop `GET /:id/status` from being an unthrottled shared-row write.** No-op when already `RESOLVED`
   (mirroring `resolve`'s converge-only guard at `ingredients.service.ts:484-486`), and move refresh to a
   signalled path. Re-add the `FoodFetchCompleted` rule
   (`food-service-stack.test.ts:394-402` currently asserts its absence) with recipe-service as the consumer, so
   propagation is a system event rather than a side effect of stranger traffic.
8. **Carve out recorded past outcomes now, while it is free.** 009's `nutrition_compliance.actual_*` pins at
   record time with a `computed_at`; a closed day is immutable. Write the forward-vs-recorded boundary into
   the ruling itself, not just into 006's edge-case list.
9. **Adopt the golden-record name on resolution** (A-6), keeping the caller's wording on
   `recipe_ingredients.display_text`.
10. **Disclose the semantics to the user.** A recipe's nutrition panel should say it reflects current food-database
    values and may change — and, once (4) exists, when it last did. The existing partial-nutrition disclosure
    (`nutrition.ts:184-196`, REQ-034) is the natural place.
11. **Record the ruling as an ADR.** It is a cross-service data-semantics decision affecting 001/003/006/009
    with no current written home, and 006's edge-case bullet (`spec.md:345-347`) is currently the only place the
    reasoning survives.

---

## Not examined

- **Runtime behaviour.** Everything above is from source; no service was run, no query executed, no
  `EXPLAIN`/heap-order behaviour empirically confirmed. The kcal/kJ _flip-on-refresh_ mechanism in A-1 is a
  well-grounded inference about unordered scans, not a measurement. The **absence of `ORDER BY`** and the
  **unit-blind match** are verified facts and are sufficient on their own.
- **Whether USDA actually emits both `Energy` rows for the foods in the current seed.** The schema _permits_
  both (`food.ts:191,226`); the seed contents were not sampled. Verified only from the prior review's finding.
- **`sanitizeCandidates` / `merge-engine.ts` blend semantics** — specifically whether the merge can drop a
  nutrient a prior fetch supplied. This determines how often the A-1(b) COALESCE-accumulation actually fires.
  The _storage_ behaviour is verified; the _frequency_ is not.
- **007 (grocery lists) and 005 (AI).** 007 consumes 006's projections and 005 may reason over nutrition; both
  may hold stability assumptions. Only 006 and 009 were read.
- **Other worktrees.** Only the main tree at `/home/brandon/Development/KitchenSink/packages` was read; the
  `.worktrees/*` copies (which include 006 and 005 branches) may have diverged.
- **The client/UI side of ingredient polling** — how often, and for which statuses, the web and mobile pickers
  call `GET /:id/status`. This sets the real-world exposure of the A-1 write-on-GET path.
- **Whether an ADR already covers this ruling.** `docs/architecture/decisions/` was not enumerated; the
  guardrail (11) assumes none exists based on the ruling being dated 2026-08-14.
