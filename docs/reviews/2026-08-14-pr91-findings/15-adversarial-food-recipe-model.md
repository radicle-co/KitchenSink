# 15 — Adversarial review: the food ↔ recipe domain model

**Date**: 2026-08-14
**Mode**: REVIEW (adversarial — the brief was to refute the model, not validate it)
**Scope**: `CLAUDE.md` "The 'food' service is really the INGREDIENT service…", `specs/001-commise-recipe-app/tasks.md` T150,
`docs/architecture/decisions/0019-recipe-import-spine.md` §5, and the shipped code on both sides of the seam.

## Governing decisions read before forming an opinion

- **`specs/001-commise-recipe-app/tasks.md:411-415` (T150, owner ruling 2026-08-08)** — the no-write-back decision, verbatim:
  _"no a finished recipe is not a food because there is more than one way to make something like a pizza."_ … _"the
  relationship is one-directional and stays that way … The food DB keeps a single writer — the USDA/source pipeline."_
- **`CLAUDE.md:224`** — the same ruling restated as a standing decision, with the two "fixes" it pre-emptively forbids.
- **`docs/architecture/decisions/0019-recipe-import-spine.md:115-134`** — §5 placeholders, and its warning box: _"A shell is
  a **food** in a pending state, created and advanced by the food service's own resolution pipeline (the USDA/source path)
  because a recipe referenced an ingredient it had not yet resolved. The food database still has exactly one writer."_
- **`docs/architecture/decisions/0014-service-owned-api-contracts.md`** — why the recipe service may not hold a wire type
  or a connection into `kitchensink_food`.
- **`docs/reviews/2026-08-14-pr91-findings/09-data-model.md:37-100` (F-DB1)** — the prior finding that the single-writer
  rule holds today, and _by what mechanism_. Load-bearing for A-3 below; I re-verified it rather than assuming it.

Two of the five attacks below were **defeated by this record**, and I say so rather than dressing them up. Three survive,
and one of those (A-4) is more severe than anything the brief anticipated.

---

## A-1 — The shared ownerless catalog is the single root design error, and the race / typeahead leak / kJ poisoning are all symptoms of it

**Claim attacked.** That one flaw — an ownerless, globally shared `ingredients` catalog — causes four defects, so
per-user (or per-recipe) ingredient→food bindings over a read-only shared catalog is the correct model, and ADR-0019 §5
is building status tracking on a broken foundation.

**Attack.** One user's disambiguation of "pepper" mutates what every other user sees; the mapping carries no ownership
and no provenance; therefore the binding belongs to the binder, not to the platform.

**Evidence.**

The "one flaw, four symptoms" framing does not survive contact with the code. The four alleged symptoms have **three
different causes**, and the two most serious are not caused by sharing at all.

1. **The resolve race is CLOSED, at the food layer, by a guarded transition.** `MergeAndPersistService.resolveFromPicks`
   runs inside a transaction whose last statement is `foodDao.setStatus({ status: 'RESOLVED' })`
   (`packages/services/food-service/src/foods/merge/merge-and-persist.service.ts:141-148`, `:355`). `FoodDao.setStatus`
   is a conditional `UPDATE … WHERE id = $1 AND status IN (<legal priors>)` that throws
   `IllegalStatusTransitionError` on `rowCount = 0` (`.../foods/dao/food.dao.ts:303-333`), and `LEGAL_PRIORS.RESOLVED`
   is `['PENDING','UNRESOLVED']` (`.../food.dao.ts:182-188`). Two concurrent `PATCH /foods/{id}` calls therefore
   serialize on the row lock; the loser re-evaluates the predicate against the committed row, matches nothing, and
   **rolls back its whole merge**. It cannot overwrite the winner's golden record. That is a real CAS, in the right
   place. The recipe-side `resolve` is read-then-act (`.../recipe-service/src/ingredients/ingredients.service.ts:475-490`)
   but both racers end up reading and writing _the same_ golden values, so there is no divergence to produce.
   The residual defect is a **failure shape**, not corruption: the loser surfaces an unhandled
   `IllegalStatusTransitionError` (no `catch` for it in `foods.service.patchResolve`, `.../foods.service.ts:318-376`)
   → 500 to the recipe service → 500 to the user, where a 200 idempotent no-op is the correct answer.
2. **The typeahead leak is a recipe-side omission, and the food service does not share it.** `FoodSearchDao` filters
   `WHERE status = 'RESOLVED'` on both of its query paths
   (`packages/services/food-service/src/foods/dao/food-search.dao.ts:221`, `:255`), so the catalog half of the blend
   never emits a shell. The leak is entirely `IngredientsDal.search`, which has no status predicate at all
   (`.../recipe-service/src/ingredients/dal/ingredients.dal.ts:155-167`) — already filed as **F-DB6**. Shared ownership
   is not the cause; a missing `WHERE` is.
3. **The kJ poisoning has nothing to do with sharing.** It is a name-substring match that ignores the unit column it is
   handed. Confirmed end to end, and worse than the brief states — see the sub-finding below.
4. **Illegal placeholder states** are real (`CHECK` constrains only the value domain,
   `.../recipe-service/src/database/schema/ingredients.ts:70-73`; nothing ties `food_id` / `food_resolution_status` /
   `is_user_entered`) — already **F-DB3**. Again unrelated to ownership.

**The proposed cure is also refuted by the code.** A per-recipe binding layer **already exists**: `recipe_ingredients`
carries `ingredient_name`, `is_user_entered`, `user_calories`/`user_protein_g`/`user_carbs_g`/`user_fat_g`, quantity and
unit per line (`.../schema/ingredients.ts:97-127`), and `nutrition.ts` gives the per-line user override strict priority
over the catalog value (`packages/shared/recipe-core/src/nutrition.ts:1-16`). The shared `ingredients` table is not an
ownership claim over the binding — it is a **dedup cache** keyed on the opaque `food_id`
(`uniqueIndex('idx_ingredients_food_id')`, `.../schema/ingredients.ts:77-79`) whose whole purpose is that N users adding
"chicken breast" cost one food-service round trip, not N. Per-user bindings would multiply the cross-service reads on a
per-keystroke path (`suggest`, `.../ingredients.service.ts:214-246`), break the `findByFoodIds` crosswalk that makes the
blend's dedup exact (`:231-235`), and fix none of the three real causes.

**What DOES survive, and it is worse than the race.** The catalog's **display name is caller-authored and never
reconciled**. `addByName` persists the user's raw trimmed string as the shared row's `name`
(`.../ingredients.service.ts:368-381` → `IngredientsDal.createFoodBacked`, `.../ingredients.dal.ts:319-352`), and
`updateResolution` — the only write that ever runs afterwards — **does not touch `name`**
(`.../ingredients.dal.ts:363-385). So a name typed once by one user becomes the permanent, globally-visible label of a
real USDA food for every other user, and it is also what `search`'s `to_tsvector`, `word_similarity`and`ILIKE` rank on
(`.../ingredients.dal.ts:155-167`). The same file already knows this is unacceptable — `addByFoodId`'s docstring says so
explicitly:

> "Accepting a caller-supplied name would let any authenticated client attach an arbitrary label to a real food in a
> catalog that is ownerless and shared by every user (data-model R5) — **mislabeled nutrition for everyone**."
> — `.../ingredients.service.ts:258-262`

The pick path was hardened against exactly this. The by-name path, three methods later, does it.

**Sub-finding — the nutrient match is worse than "unit-blind".** `extractNutrition` matches on a lowercase substring of
the nutrient _name_ and takes `Array.prototype.find`'s first hit
(`.../ingredients.service.ts:60-68`, `:126-136`). Three facts make that non-deterministic rather than merely sloppy:

- the golden-record nutrient select has **no `ORDER BY`** (`.../food-service/src/foods/dao/food.dao.ts:434-446`), so wire
  order is whatever Postgres returns and can change after a `VACUUM`, an update, or a plan change;
- `Energy` exists **twice** as a dictionary entry, because `nutrient` is unique on `(name, unit)`, not on name
  (`.../food-service/src/db/schema/food.ts:190-191`; `NutrientDao.resolve`, `.../dao/nutrient.dao.ts:106-112`), and the
  bulk importer ingests **every** nutrient in `nutrient.csv` with no whitelist (`mapBulkNutrients`,
  `.../sources/usda/bulk/usda-bulk.parser.ts:184-214`) — including USDA 1008 `Energy`/KCAL and 1062 `Energy`/kJ
  (`.../bulk/__fixtures__/usda-bulk.fixtures.ts:60`, `:64`), where `kJ` is explicitly _not_ in `BULK_UNIT_TO_API_UNIT`
  and falls through to lowercase `kj` (`.../usda-bulk.parser.ts:80-86`);
- `'Fatty acids, total saturated'` (`LABEL_NUTRIENT_MAP`, `.../sources/usda/usda.adapter.ts:102`) lowercases to a string
  containing `'fat'`, and `'Total lipid (fat)'` contains both `'lipid'` and `'fat'`.

So calories can be stored as kilojoules (×4.184) and fat as saturated fat, **non-deterministically per food**, into a
row every user shares, and then denormalized onto `recipes.lead_calories_per_serving`
(`.../recipe-service/src/database/schema/recipes.ts:124`). The wire already carries the answer: `FoodView.nutrients[].unit`
and `nutrient.external_code` (the INFOODS tagname) are both present and both ignored
(`.../food-service/src/foods/foods.service.ts:416-421`, `.../db/schema/food.ts:190`).

**Verdict: WEAKENED.** The "one root flaw, four symptoms" thesis is **refuted** — three independent causes, and the
worst two are not caused by sharing. The proposed per-user-binding cure is **refuted** by the existing
`recipe_ingredients` override layer. But a _different_, sharper form of the shared-ownership attack **survives**:
the shared row's **name** is unowned, caller-authored, unmoderated and permanent, and the file forbids exactly this
two methods away.

**What must change.**

1. `addByName` must not write a caller-supplied name into the shared catalog. Persist the food service's own
   `normalizedName`/display name — or write the caller's string only to `recipe_ingredients.ingredient_name` (which is
   already the per-line display field) and let the shared row carry the golden name, backfilled on `RESOLVED`.
   (`ingredients.service.ts:368-381`, `ingredients.dal.ts:363-385` gains `name`.)
2. Match nutrients by `external_code` first, then `(name, unit)` exactly — never a substring, never unit-blind.
   Add `ORDER BY` to the golden-record nutrient select so the wire order is at least deterministic
   (`food.dao.ts:434-446`), and treat two `Energy` hits as a **defect to reject**, not a value to pick.
3. Status-filter the local typeahead (F-DB6) and add the composite `CHECK` (F-DB3). Both stand independently.
4. Convert the losing `patchResolve` to an idempotent 200 by catching `IllegalStatusTransitionError` and re-reading,
   rather than 500-ing (`foods.service.ts:318-376`).

**ADR-0019 §5 is NOT built on a broken foundation** on this axis. Its shell placeholder rides on the food service's
already-guarded status machine, which is the strongest part of this whole seam.

---

## A-2 — "A recipe is a method, not a substance" conflates the dish concept with the recipe instance

**Claim attacked.** T150's reasoning: _"there is more than one way to make something like a pizza"_, so registering a
recipe as a food would _"assert a nutritional identity that does not exist"_.

**Attack.** That argument is about **pizza the type**. A _specific_ recipe with specific quantities and a specific yield
has a **determinate** computed nutrition. The reasoning proves that "pizza" should not be a food; it does not prove that
"Brandon's 2026-08-14 margherita, 4 servings" should not be. If the argument were sound, the platform could not display
per-serving calories for a recipe either — yet it does.

**Evidence.**

The premise is contradicted by shipped code in the same repository. `aggregatePerServing` computes exactly the
determinate nutritional identity the ruling says does not exist, and does it _purely_, with an explicit
`isComplete` flag for the lines it cannot account for (`packages/shared/recipe-core/src/nutrition.ts:1-17`). It is
persisted as a headline (`recipes.lead_calories_per_serving`, `.../schema/recipes.ts:120-124`), and feature 006
consumes it as the authoritative number for a whole meal plan:

> "**Nutrition rollup** _(revised)_ | **Pure read-time fold** over recipe-level `RecipeNutrition × servings`"
> — `specs/006-meal-planning/research.md:447`

So the system already asserts a per-recipe nutritional identity, at scale, for planning. The ruling's stated rationale
therefore proves too much.

**But the ruling is still right, for a reason it does not give.** The food database's identity key is
`uniqueIndex('food_normalized_name_unique')` (`.../food-service/src/db/schema/food.ts:110`), and `normalizeName` is
nothing but trim + collapse-whitespace + lowercase (`.../foods/merge/merge-engine.ts:130-132`). There is exactly **one**
row for `"pizza"` in the entire platform. Registering a finished recipe as a food would either collide with that row or
_become_ it — one cook's numbers served to every user who types "pizza", forever, in a catalogue whose values are
otherwise lab-analyzed USDA measurements with per-value provenance
(`food_nutrients.source_id` + the same-food provenance FK, `.../db/schema/food.ts:226-236`). That is the real argument,
and it is far stronger than the one recorded: **the food catalogue is a name-keyed, provenance-bearing global namespace,
and user-authored composites have no legitimate key in it.**

**What the model loses — priced honestly.**

- **Sub-recipes.** `grep -rn "sub-recipe|subrecipe|nested recipe|component recipe" specs/ docs/` returns **zero** hits.
  No feature asks for it. The accepted consequence is currently free.
- **006 (meal planning)** is not blocked: it never calls the food service at all
  (`specs/006-meal-planning/research.md:447` "006 never calls the food service; nutrition is already resolved and
  denormalized by 001").
- **009 (nutrition planning)** is not blocked: its "actuals" come from 006's fold, not from a food log
  (`specs/009-nutrition-planning/research.md:519`, `:303`). Its FRs are targets and compliance
  (`specs/009-nutrition-planning/spec.md:47-49`), not arbitrary food logging.
- **007 (grocery lists)** is not blocked: it aggregates recipe ingredient _lines_
  (`specs/007-grocery-lists/spec.md:62`), which needs no composite entity.

**Verdict: SURVIVES on its conclusion, REFUTED on its stated reasoning.** The "two cooks' pizzas" argument is a
type/instance conflation and is contradicted by `nutrition.ts` + 006. The conclusion is nonetheless correct, on
namespace grounds the ruling never states.

**What must change.** Rewrite T150's rationale (and the `CLAUDE.md:224` restatement) to the namespace argument:
`food.normalized_name` is `UNIQUE` and global, food values carry USDA provenance, and a user-authored composite has no
key and no provenance in that space. Keep the ruling. Add one sentence recording that the sub-recipe consequence is
currently **unpriced** because no spec demands it — so the next reader knows the cost was not measured, only deferred.

---

## A-3 — "One-directional" and "single writer" are already false in practice

**Claim attacked.** ADR-0019 §5: _"A shell is a food in a pending state, **created and advanced by the food service's own
resolution pipeline (the USDA/source path)** … The food database still has exactly one writer."_

**Attack.** If a recipe import causes a shell row to appear in `food`, the recipe pipeline is causally writing to the
food DB through an API. "Single writer" is then a naming convention, not an invariant.

**Evidence.**

**The mechanism holds.** F-DB1 (`09-data-model.md:37-100`) established it and I re-verified the load-bearing parts:
the recipe service reaches `kitchensink_food` only over HTTP through `@kitchensink/food-service-client`
(`.../recipe-service/src/ingredients/ingredients.service.ts:342`, `:370`, `:404`); every status advance goes through
`FoodDao.setStatus`'s guarded conditional UPDATE (`.../food.dao.ts:303-333`); and the recipe-side status column is only
ever written from a food-service-returned value (`.../ingredients.service.ts:296-297`, `:380`, `:406-411`, `:418-419`).
No route lets a caller set a status. **"Second writer" is refuted.**

**But the ADR's sentence is false as written, and the falsehood is load-bearing.** `FoodDao.createByName` inserts the
shell with `status = 'PENDING'` from a **caller-supplied `normalized_name`** and a caller-supplied display name
(`.../foods/dao/food.dao.ts:239-289`, called from `FoodsService.addByName`, `.../foods.service.ts:208`). The USDA
pipeline does not create that row and does not choose its identity; it _populates_ it afterwards. What the recipe side
authors is the food database's **key space** — `normalized_name` is the unique identity of a food
(`.../db/schema/food.ts:110`), and it comes from a string a recipe user typed.

So the true invariant is **"one write authority"** (one process, one credential, one guarded transition set), not
**"one writer, the USDA/source pipeline"**. Those are different claims and only the first is true.

**What concretely stops it degrading: nothing enforced.** F-DB1's own recommendation W1 — "the per-stage DB credential
for the food schema is not granted to the recipe service's task role" — is written as a _recommendation with an
ownership check assigned_, i.e. it is not in place. Today the barrier is that nobody has written the second connection.
ADR-0019 §4 adds a push channel and a 1,000-recipe bulk import with **no batch status read** on the food contract
(F-DB16), which is precisely the pressure that produces one.

**Verdict: WEAKENED.** The single-write-authority invariant genuinely holds and the attack's strong form is refuted. The
ADR's stated invariant is factually wrong about who creates a shell, and the enforcement is convention plus absence of
motive.

**What must change.**

1. Restate §5's box as: _"A shell is created **through the food service's own API**, by `POST /api/v1/foods{,/batch}`,
   from a name. The food service is the sole **write authority**: it owns the only connection to `kitchensink_food` and
   the only guarded transition set. The USDA/source pipeline is the sole **value** author — it does not create rows."_
   The distinction is what a future reader needs.
2. Implement F-DB1 W1 as an actual grant boundary, not a note. A convention that is only true because nobody tried is
   not an invariant.
3. Add the batch status read (F-DB16) before the bulk importer ships, so the pressure never exists.

---

## A-4 — The opaque `food_id` has no stable meaning under shell semantics, and one collision is unrecoverable

**Claim attacked.** That referencing ingredients by an opaque `food_id` is a sound one-directional coupling.

**Attack.** What happens when a shell resolves to a _different_ canonical food, when the USDA record is withdrawn, when
the values change upstream, or when two shells claim the same source item? Is there any pinning or versioning?

**Evidence. Four failures, none of which has a mitigation in the code.**

**(i) A terminal food is reactivated on the SAME id, silently changing what the reference means.**
`createByName`'s `ON CONFLICT` promotes a `NOT_FOUND`/`FAILED` row back to `PENDING` once its `tombstoned_at` passes the
terminal TTL — same row, same id (`.../foods/dao/food.dao.ts:255-268`; `LEGAL_PRIORS.PENDING = ['FAILED','NOT_FOUND']`,
`:182-188`). The recipe row that recorded `NOT_FOUND` is never re-polled: `refreshStatus` only runs when a client calls
`GET /ingredients/{id}/status` (`.../ingredients.controller.ts:272`), and a client stops polling a terminal row by
design (`.../ingredients.service.ts:18-24`). So the ingredient stays `NOT_FOUND` forever while its `food_id` now points
at a fully `RESOLVED` substance — possibly a different one, since a later user's identical typed name drives the
re-fan-out.

**(ii) `RESOLVED` nutrition is rewritten in place, under a stable id, with no notification.**
`ChangeRefreshConsumer` scans every `RESOLVED` food's backing items and re-enqueues on an upstream `item_version` change
(`.../worker/change-refresh/change-refresh.consumer.ts:1-22`); `mergeChangedSources` then rewrites the golden nutrients
and portions in place and deliberately keeps the food `RESOLVED`
(`.../foods/merge/merge-and-persist.service.ts:150-165`). **There is no path by which that reaches
`ingredients.calories_per_100g`.** The only writer of that column is `updateResolution`
(`.../ingredients.dal.ts:363-385`), reachable only from a client poll of a non-terminal row or a pick. A resolved
ingredient's nutrition is therefore written once and never again.

**(iii) There is no version, no pin, and no as-of anywhere on the recipe side.** The `ingredients` table has `created_at`
and nothing else — no `updated_at`, no `resolved_at`, no `food_item_version`
(`.../recipe-service/src/database/schema/ingredients.ts:48-88`). The food side _does_ track the upstream revision
(`food_sources.item_version`, `.../db/schema/food.ts:161-164`) and never propagates it. So no consumer — and no
operator — can tell whether a stored per-100g value is five minutes or two years stale, or which upstream revision
produced it. (Cf. **F-DB4**, which found the same absence from the status-freshness angle.)

**(iv) Two differently-named foods resolving to the same USDA item is an unrecoverable failure, and the codebase already
knows it.** The crosswalk is `unique('food_sources_source_key_unique').on(source, externalKey)` — **globally**, not
per-food (`.../db/schema/food.ts:161`). `upsertSource`'s `onConflictDoUpdate` sets `itemVersion`/`fetchState`/`fetchedAt`
and **not** `foodId` (`.../foods/dao/food-sources.dao.ts:69-72`), so the row keeps its original owner. And
`food_nutrients_provenance_same_food_fk` is a composite FK `(food_id, source_id) → food_sources(food_id, id)` that
"forces provenance to reference a crosswalk row of the SAME food" (`.../db/schema/food.ts:203-236`, mirrored for
`food_portions` at `:250-266`). `persistResolved` writes nutrients with the returned crosswalk's `source_id` against
_its own_ `foodId` (`.../merge-and-persist.service.ts:274-357`). Put together: the second food to resolve to an already-
claimed `(usda, fdcId)` aborts its transaction on a `23503`.

The bulk importer documents this exact trap and defends against it:

> "Idempotency comes from `findByExternalKey` → REUSE the existing `food_id`, **not** from the crosswalk's
> `UNIQUE(source, external_key)`. A blind 'create a new food, then upsert the crosswalk' would hit that unique index and
> `onConflictDoUpdate` — which does NOT update `food_id` — leaving the crosswalk row pointing at the OLD food while the
> nutrient/portion values are written against the NEW one, tripping the composite same-food provenance FK."
> — `.../foods/seed/bulk-seed.service.ts:18-24`

**The user-driven path has no such pre-check.** `findFoodIdByExternalKey` exists (`.../dao/food-sources.dao.ts:92-100`)
and is called from exactly one place: `FoodsService.search`, for barcode/key lookup (`.../foods.service.ts:184-187`).
Neither the worker fan-out (`FoodConsumerService` → `resolveAndPersist`, `.../worker/food-consumer.service.ts:307`) nor
the manual pick (`patchResolve` → `resolveFromPicks`, `.../foods.service.ts:373`) consults it. And the collision is
easy to reach, because food identity is name-keyed with a normalizer that only lowercases and collapses whitespace
(`.../merge/merge-engine.ts:130-132`): `"chicken breast"`, `"chicken breast, raw"` and `"chix breast"` are three
distinct food rows, and a user can pick the _same_ USDA candidate for all three. The second and third get a 500, no
`23503` handler exists anywhere in the service (`grep 23503|foreign_key_violation` → only the schema and the bulk-seed
docstring), the food stays `UNRESOLVED`, its candidate set is intact, and every retry fails identically. The recipe-side
user's ingredient is **permanently stuck** with no path forward but freeform.

**A recipe consequence that contradicts a docstring.** `toNutritionLine` claims:

> "so a card's stored `leadCaloriesPerServing` and the detail's live `nutrition.calories` are computed from
> byte-identical inputs and **can never disagree**."
> — `packages/shared/recipe-core/src/nutrition.ts:62-67`

That holds only at write time. `lead_calories_per_serving` is recomputed on the recipe's next write
(`.../database/migrations/0012_lead_calories_per_serving.sql:13`), while the detail folds live over the shared
`ingredients` row. Any later change to that shared row — another user's pick backfilling nutrition, a corrected
nutrient match, a status advance — makes the card and the detail disagree, indefinitely. The docstring states an
invariant the shared mutable catalog does not provide.

**Verdict: SURVIVES — the strongest finding in this review.** The `food_id` is stable as a _string_ and unstable as a
_meaning_. Sub-finding (iv) is a data-integrity dead end, and the fix is already written down for a sibling path.

**What must change.**

1. **Close (iv) first — it is a live outage shape.** Before creating a food from a candidate, resolve
   `findFoodIdByExternalKey(source, externalKey)`; if it returns another food id, **converge onto it** (alias the
   caller's shell, or return the existing id) rather than minting a second owner. Mirror the bulk importer's
   find-or-create. Failing that, at minimum catch `23503` on that constraint and surface a modelled 409 instead of a
   500, so the shell is not silently wedged. Owner: `be-1` + `db-arch-1`.
2. **Give the reference an as-of.** Add `resolved_at` and `food_item_version` to `ingredients`
   (`.../schema/ingredients.ts:48-88`). Persisted schema → **one-way door**; do it once, additively.
3. **Decide, explicitly, what a terminal-then-reactivated food means to a recipe** — either the recipe-side terminal
   state carries the tombstone anchor and is re-checkable, or reactivation must mint a **new** food id. Reusing the id
   across a semantic discontinuity is the defect.
4. **Give `mergeChangedSources` a propagation path** (an emitted change notification per ADR-0019 §4, consumed by the
   recipe service to re-poll), or state in the ADR that resolved ingredient nutrition is a **pin** and is deliberately
   never refreshed. Either is defensible. Silence is not.
5. **Correct or delete the `nutrition.ts:62-67` "can never disagree" claim.** A docstring asserting a false invariant is
   worse than none.

---

## A-5 — Recipes should pin an immutable nutrition snapshot at resolution time, not hold a live reference

**Claim attacked.** That the current live-reference model is the right shape.

**Attack.** A snapshot beats it on correctness and auditability: the recipe's numbers cannot change under the user, and
you can say what they were derived from.

**Evidence.**

**The framing is wrong, and that is the finding.** The current model is **not a live reference**. It is _already_ a
snapshot — an undeclared one. `ingredients.calories_per_100g` and its siblings are a copy of the golden record written
once by `updateResolution` (`.../ingredients.dal.ts:363-385`) with no refresh path for a `RESOLVED` row (A-4(ii)), and
`recipes.lead_calories_per_serving` is a copy of a copy, recomputed only on the recipe's next write
(`.../migrations/0012_lead_calories_per_serving.sql:5-13`). So the real choice is not snapshot-vs-live. It is:

> an **accidental** snapshot with no `as_of`, no source version, no audit trail and no invalidation
> **versus** a **declared** one that carries all four.

Stated that way the steelman wins on the evidence, because every property the current design lacks is a property a
declared pin would have to supply.

**The one piece of evidence that appears to defeat it, and why it does not.** Feature 006 explicitly **reversed** a
snapshot design:

> "**Nutrition rollup** _(revised)_ | **Pure read-time fold** … | A snapshot is a second source of truth that goes
> stale on every recipe edit." — `specs/006-meal-planning/research.md:447`

and eliminated the corresponding hazard outright — "There is no cache and no stored rollup; totals are recomputed from
current recipe nutrition on every read (REQ-CN-004)" (`specs/006-meal-planning/v-model/hazard-analysis.md:108`) — with
`STS-003-A6` standing as a permanent guard against a rollup table reappearing
(`specs/006-meal-planning/v-model/system-test.md:100`).

That decision is about a **derived aggregate over a mutable entity the user owns** (their own recipe, which they edit and
expect to see reflected). The pin proposed here is a **reference to an immutable external observation** (a USDA
measurement at a known revision). Different objects, opposite correct answers — and citing 006 against this would be
the mistake. Where the two agree is the part that indicts the status quo: _do not keep a second source of truth that
goes stale silently._ `ingredients.calories_per_100g` is exactly that today, and 006's own reasoning condemns it.

**What it costs.** A pin needs three things: `resolved_at` + `food_item_version` on the row; a re-pin action (user- or
operator-initiated); and a surface that says "the source data for this ingredient changed since you saved" — otherwise a
genuine USDA correction never reaches a saved recipe, which is right for a saved recipe and wrong for the typeahead. The
typeahead should stay live (it already is: `FoodSearchDao` reads the food service directly,
`.../food-search.dao.ts:221`), so the split is clean: **live for discovery, pinned for what a recipe stores.**

**Verdict: SURVIVES**, restated. Not "snapshot beats live reference" — the model has no live reference — but
"**declare the snapshot that already exists, and give it the version and timestamp that make it auditable**."

**What must change.** Same as A-4 item 2 (`resolved_at` + `food_item_version`), plus an explicit ADR line stating that a
recipe's stored nutrition is as-of its resolution and does not track upstream corrections. That sentence is currently
missing from every document, which is why the behaviour reads as a bug to anyone who finds it.

---

## Where the model held

Stated plainly, because a review that finds only faults is not a review.

- **The food service's status machine is the strongest thing at this seam.** `LEGAL_PRIORS` + a conditional
  `UPDATE … WHERE status IN (…)` that throws on `rowCount = 0` (`.../foods/dao/food.dao.ts:182-188`, `:303-333`) is a
  correctly implemented guarded State pattern. It closed the concurrent-resolve race I was sent to find (A-1), and it is
  what makes ADR-0019 §5's shell placeholder safe to build on. The recipe side's projection has **no** equivalent guard
  (F-DB7) — the asymmetry is the defect, not the food-side design.
- **Single write authority is real, not aspirational.** Verified: no second Drizzle client or pool points at the food
  schema; every advance is food-service-internal; the recipe copy is written only from food-originated values (A-3).
- **The no-write-back ruling is correct**, even though its recorded reasoning is not (A-2). Nothing in 006, 007 or 009
  is blocked by it, and no spec anywhere asks for sub-recipes.
- **`addByFoodId` is properly hardened** — read-then-create so the display name comes from the food service, with the
  reasoning written down at `.../ingredients.service.ts:249-266`. It is the correct model; `addByName` is the one that
  departs from it.
- **The provenance FKs are right.** `food_nutrients_provenance_same_food_fk` / `food_portions_provenance_same_food_fk`
  (`.../db/schema/food.ts:203-236`, `:250-266`) make a cross-food provenance write impossible. A-4(iv) is a failure to
  _anticipate_ that constraint on one path, not a fault in the constraint — which is doing exactly its job by refusing
  the write.
- **`FoodCatalogGateway`'s availability discipline** — concurrent reads, short timeout, total (no-throw) degradation on
  the catalog half and a real 500 on the local half (`.../ingredients.service.ts:193-200`, `:222-229`) — is a correctly
  contracted Circuit-Breaker/Bulkhead composition. Do not "simplify" it.
- **Per-recipe overrides already exist** in `recipe_ingredients` with strict priority over the catalog
  (`.../schema/ingredients.ts:97-127`, `packages/shared/recipe-core/src/nutrition.ts:1-16`), which is why the per-user
  binding proposal was refuted rather than adopted.

## Not examined

- Whether the FK-violation path in A-4(iv) has ever fired in sandbox or production. I read the code and the constraints;
  I ran no query and read no logs. The reachability argument is analytical.
- `FoodConsumerService`'s fan-out and candidate-survivor logic beyond the `resolveAndPersist` call site
  (`.../worker/food-consumer.service.ts:307`) — a candidate-set pre-filter there could in principle already exclude an
  externally-claimed key, though `findFoodIdByExternalKey` has no caller there.
- The `POST /api/v1/foods/batch` path (`.../foods.service.ts:248-297`) against A-4(iv): intra-batch dedup is on
  `normalizeName`, so two batch names colliding on one fdcId hit the same trap, but I did not trace the batch drain.
- 004's and 011's import-side code (unbuilt at review time). A-3's degradation argument is about the pressure ADR-0019
  creates, not about shipped import code.
- Mobile/web client behaviour on a wedged `UNRESOLVED` ingredient — whether the UI offers the freeform fallback that
  A-4(iv) leaves as the only exit.
- k6/load behaviour of the `suggest` blend under the per-keystroke cross-service read.
- Anything in features 010–014.

## Hand-off

| Finding                                                                   | Owner                | Why                                                                                 |
| ------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| A-4(iv) crosswalk collision → wedged shell                                | `be-1` + `db-arch-1` | Live data-integrity dead end; fix pattern already exists in `bulk-seed.service.ts`  |
| A-1 nutrient match by code/(name,unit), `ORDER BY` on the nutrient select | `be-1`               | Silent ×4.184 calorie error into a shared row                                       |
| A-1 caller-authored shared catalog name                                   | `be-1`               | Contradicts `addByFoodId`'s own stated rule                                         |
| A-4(2)/A-5 `resolved_at` + `food_item_version` on `ingredients`           | `db-arch-1`          | Persisted schema — **one-way door**, additive-only                                  |
| A-2 / A-3 wording of T150, `CLAUDE.md:224`, ADR-0019 §5                   | `staff-engineer`     | The written record is the only memory; both currently mis-state their own rationale |
| F-DB1 W1 as an actual grant boundary                                      | `sre-1`              | Convention is not an invariant                                                      |

**Tests owed** (`docs/CODING_STANDARDS.md §7.1`): unit **and** integration for every change above (all non-UI);
integration is mandatory for A-4(iv) — a real-Postgres test that resolves two differently-named foods to one
`externalKey` and asserts convergence rather than `23503`. A property test over `extractNutrition` against a golden
record containing both `Energy` rows and `Fatty acids, total saturated`, asserting kcal and total fat, in **either**
row order. Services touched (food, recipe) additionally owe e2e + k6 per the standing policy.

**Confidence: High** for A-1, A-3, A-4 and A-5 — every claim is anchored to code I opened, and the two attacks that
failed are recorded with what defeated them. **Medium** for A-4(iv)'s _frequency_ (the mechanism is proven from the
constraints and the call graph; the rate at which real users collide on one fdcId is not measured) and for A-2's
"nothing is blocked" conclusion, which rests on specs as written rather than on unbuilt code.
