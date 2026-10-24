---
type: feat
origin: conversation (owner rulings, 2026-09-07 / 2026-09-08)
status: planned
---

# Author-private foods, withdrawal, and lazy detection in recipes

## Problem

`food-service` calls `recipe-service` in a user request path. `FoodsService.deleteAuthored` asks recipe
whether any recipe references the food, refuses with `409 FOOD_REFERENCED` if so, and fails **closed** with
`503` if recipe is unreachable. That inverts the documented relationship — `CLAUDE.md` states the food↔recipe
edge is one-directional, which is true of the DATA and false of the SERVICES — and it makes a food-side write
depend on another service being up.

It is also the reason `FoodServiceStack` sets `RECIPE_SERVICE_URL` by recomputing another service's origin,
and the reason `@kitchensink/recipe-service-client` is a food-service dependency.

## Owner rulings

Recorded verbatim in intent; all made 2026-09-07/08.

1. **Food must not call recipe.** "The recipe service needs to handle when it detects that a food item has
   been deleted — the food service should not be updating recipes."
2. **Users can delete their own food**, unconditionally. The reference check goes.
3. **Detection is lazy** — "the recipe only finds out when the recipe is fetched." No event-driven push, no
   polling, no notification.
4. **Display a warning in the recipe** that a food was deleted and is no longer available, placed where it
   fits the recipe and is actually seen.
5. **Soft delete, not hard delete** — "so that we can provide information about what was deleted." Sweeping
   the database later is explicitly **out of scope**.
6. **Withdrawn foods do NOT return macros.**
7. **Authored foods are author-only** — only the creator can see and use their own food. Stop promoting
   anything. A request-to-publish flow, or lifting the restriction wholesale, comes later once other concerns
   about custom foods are settled.
8. **Remove the promotion machinery** rather than suspending it.

No foods are currently referenced by any recipe, so **no data migration for existing references is owed**.

## ⛔ This is three changes, not one — and the build order is load-bearing

The rulings stack into three separable pieces with different blast radii. They are planned together because
they interact, and sequenced apart because bundling them makes the diff unreviewable and the riskiest step
invisible.

|       | Change                                                                         | Why it is separable                                                                                         |
| ----- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **A** | Authored foods become author-only; promotion machinery removed                 | Deletes a published wire contract and 3 routes. Independently valuable. Makes B and C dramatically smaller. |
| **B** | Voluntary delete becomes a withdrawal (soft delete); food stops calling recipe | The original ask. Needs A's simplification to be safe.                                                      |
| **C** | Recipe detects withdrawal at read and shows it                                 | Pure read path once B publishes the status.                                                                 |

**A must land first**, because it removes the only way a food can be referenced by someone other than its
author — which is what makes B's unconditional delete safe, and what collapses most of C's edge cases.

## Change A — authored foods are author-only; remove promotion

### What "promoted" is today

`visibility` is `public` (USDA catalog rows, `user_id IS NULL`) | `private` (authored, author-only) |
`promoted` (authored, human-moderated, world-readable). Authored foods are already author-private by default
— `db/schema/food.ts:131`, "Q3c: author-PRIVATE until promoted", enforced by the `food_visibility_coherent`
CHECK. Promotion is an operator action that flips a row to `promoted` and, in a second phase, writes a
**global curated mapping** in recipe binding an ingredient phrase to the new canonical.

So ruling 7 is mostly **"stop promoting"** rather than a new restriction: the private default already exists.
What changes is that `promoted` stops being reachable.

### Remove

| Path                                                                                        | Note                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/schemas/food/src/schemas/promotions.schema.ts`                                    | **published wire contract** — a removal, one-way |
| `packages/services/food-service/src/foods/admin/promotions.schema.ts`                       |                                                  |
| `packages/services/food-service/src/foods/dao/promotions.dao.ts`                            |                                                  |
| `packages/services/food-service/src/foods/domain/promotionPolicy.ts`                        |                                                  |
| `packages/services/food-service/src/foods/promotions/promotions.service.ts`                 |                                                  |
| `packages/services/food-service/src/foods/promotions/promoteCli.ts`                         | the second food→recipe call path                 |
| the 3 moderation routes                                                                     |                                                  |
| `tests/promotionsApi.integration.test.ts`, `tests/foodPromotionsSchema.integration.test.ts` | say where coverage went in the commit message    |
| `packages/services/recipe-service/src/ingredients/resolution/mappingPromotionAudit.ts`      | recipe-side half                                 |
| `'promotion'` from `ingredients.schema.ts:280`'s `surfacing` union                          | wire narrowing on recipe                         |

**⚠️ Do NOT remove** the `promoted` value from the `visibility` column or its CHECK. Postgres cannot remove
an enum value, the column is text with a CHECK, and leaving the value unreachable-but-valid keeps the door
open for ruling 7's "lift the restriction later" without another migration. Record it as deliberately dead.

**⚠️ Verify before writing code:** whether any row currently has `visibility = 'promoted'` in any live stage,
and whether recipe holds any `scope='global'` mapping with `surfacing='promotion'`. Both are assumed empty;
if they are not, this change acquires a data question it does not currently have.

### Consequence that shrinks everything downstream

With nothing promotable, **a food can only ever be referenced by its own author's recipes.** Therefore:

- One author's delete can never degrade a stranger's recipe. The "restrict deleting promoted foods" question
  is **moot** — there are no promoted foods.
- The **global-mapping poisoning defect disappears**: global mappings pointing at authored foods were written
  by promotion phase 2, which no longer exists.
- The `FoodWithdrawn` **reconciler is no longer owed for that job**. Its remaining job (refreshing recipe's
  stale local mirror so `addByFoodId` stops short-circuiting) is author-scoped and self-correcting on the next
  refresh. **Deferred, not cancelled** — see Open items.
- **`food` stops calling `recipe` entirely**, by deletion rather than redesign. `@kitchensink/recipe-service-client`
  can be dropped from `package.json` and `prod.package.json`, which is the real proof the edge is gone.

## Change B — withdrawal replaces deletion

### The status

Add **`WITHDRAWN`** to the pg enum, to `foodStatusSchema`, and to `foodResolutionStatusSchema`.

**⛔ Do not reuse `DELETING`.** Three independent reasons, all verified:

- `publishableStatusOf` (`foods.service.ts:111`) is typed `Exclude<FoodStatus, 'DELETING'>` and **throws** —
  "`DELETING` is store-internal and must not reach the wire (U18)". Called from 8 sites.
- `DELETING` is **in-flight, not terminal**: `food.dao.ts:249,258` allows `RESOLVED → DELETING → RESOLVED`, and
  `eraseFoodRows.ts:55` reverts referenced foods back to `RESOLVED` as orphans. A read during an erasure window
  would assert a terminal fact about a state that is about to un-happen — the same collapse ADR-0026 §3
  refuses.
- `DELETING` is not on the wire enum at all, so a new **wire** member lands the compile error exactly where it
  is wanted: `foodStatusTranslation.ts`'s exhaustive switch.

**⛔ The partition forcing function.** `foods.schema.ts:63-72` records that `pendingFoodStatusSchema` +
`RESOLVED` + `terminalFoodStatusSchema` partition `foodStatusSchema`, asserted exhaustively. `WITHDRAWN`
belongs in **neither** existing arm — terminal means `404`, and the ruling requires the row stay readable. Widen
the partition to **three arms**; `getStatus` answers **`200` with `status: 'WITHDRAWN'`**. Do not jam it into
`terminalFoodStatusSchema` to make the test pass.

### Macros are withheld (ruling 6)

`getNutritionBatch` must **not** return macros for a withdrawn food. Accepted consequence, stated so it is a
decision and not a surprise: **a recipe's nutrition total changes on the day a food is withdrawn** — the line
stops counting and `isComplete` flips false. That is precisely what the recipe-side tile explains. The retained
row buys the _fact_ and the _date_, not the numbers.

### Migrations (food DB) — two files, and the split is not stylistic

1. `ALTER TYPE food_status ADD VALUE 'WITHDRAWN';` **alone in its own file.** Postgres permits `ADD VALUE`
   inside a transaction but forbids _using_ the value in that same transaction; `applyMigrations` runs each
   file transactionally, so a combined file fails at runtime behind a green synth.
2. Replace the dedup index. `food_normalized_name_per_author_unique` is `(normalized_name, user_id) WHERE
user_id IS NOT NULL` — **status-blind**, so a retained tombstone would **block the author re-adding the
   same name**. That is a user-visible regression this ruling creates. New predicate:
   `WHERE user_id IS NOT NULL AND status <> 'WITHDRAWN'`. The catalog-unique index needs no change.

Add **`withdrawn_at timestamptz NULL`**. A status cannot answer _when_, ruling 5 wants to tell a cook what was
deleted, and it is the only thing that makes the future sweep implementable without guessing.

Transition table (`food.dao.ts:245`): add `WITHDRAWN: ['RESOLVED']`. Do **not** add `WITHDRAWN` to `RESOLVED`'s
priors — un-withdrawal is not ruled. Terminal for now; additive later.

### `deleteAuthored` becomes

`evaluateAuthorship` (unchanged) → `setStatus({ id, status: 'WITHDRAWN' })` guarded from `RESOLVED` → done.

The `DELETING` tombstone-first step goes with the check it protected. That removes a real stuck state: a crash
between `setStatus DELETING` and the reference check currently leaves a food permanently `DELETING` and
un-addable with no repair path. Delete `deleteAuthoredRow` and its owner-scoped `DELETE`; nothing else calls it.

CASCADE children (macros, portions, `food_versions`) are **retained** — that is the point. **Accepted
consequence:** storage grows without bound because the sweep is out of scope, and `food_versions` keeps every
edit of a withdrawn food. Recorded in the ADR, not left to be discovered.

### Also in B — a live bug this promotes to the main path

`readNutritionBatch` (`food.dao.ts:699`) does **not** filter on status, and `getNutritionBatch` then calls
`publishableStatusOf`, which **throws** on `DELETING`. Today a promoted food mid-erasure **500s the entire
nutrition batch** for every recipe in the request. Narrow now; routine once withdrawal is normal. `WITHDRAWN`
being publishable removes the throw for the new case — **the `DELETING` case must still be handled explicitly**
(omit the id, or report it; never throw). Fix it in B with its own test.

### Remove with B

Food's `FOOD_REFERENCED` and `REFERENCE_CHECK_UNAVAILABLE` error-envelope members (`foods.schema.ts:770`), the
filter mapping (`apiException.filter.ts:124`), the `FoodReferenceCheck` port, `recipeReferences.client.ts`, the
module provider, `RECIPE_SERVICE_URL` from `env.schema.ts`, and the env var from `FoodServiceStack`. A wire
narrowing on food — one-way.

⚠️ `FoodServiceStack`'s `publicServiceOriginForStage` import goes with it, but **`publicServiceOriginForStage`
itself and `packages/tools/loadtest/publicOriginHost.mjs` + `publicOriginHostParity.test.ts` all STAY** —
they have many other consumers (`printPublicOrigin.mjs`, two guards, five workflows). An earlier draft of this
plan said they would be orphaned. That was wrong.

## Change C — recipe detects and displays

### Detection

`FoodNutritionEntry` currently carries macros + `freshness` and **discards food's status**, while the line's
status on the read path comes from the _persisted_ `ingredients.food_resolution_status` mirror — stale until
some write path refreshes it. Without a change, a food withdrawn yesterday still reads `RESOLVED` forever.

So `FoodNutritionEntry` gains `status`, translated at the boundary through the existing anti-corruption layer,
and a new pure overlay prefers the live status over the persisted one **without writing**:

```
resolveLineStatus(…) → foodPresenceStatus(persisted, live) → viewerLineStatus(…)   // viewer stays LAST
```

Overlay ordering is load-bearing: the viewer overlay must remain last so a privacy answer never degrades into a
factual claim about deletion.

**Derive at read; do not persist.** A withdrawal is presumptively restorable, so a persisted mirror goes stale
in the worse direction — showing "removed" on a restored food. It also avoids a second recipe-side write path.

**`unknownIds` is a separate latent bug.** Food already returns it and recipe already parses and discards it.
It stays reachable (erasure's delete-if-unreferenced arm still hard-deletes). After this change an unknown id
means something is _wrong_ — a reference to a row nobody withdrew — which deserves a metric and a log more than
a UI state. **Fix it in its own commit**, and keep it distinct from `WITHDRAWN` for the same reason `DELETING`
and `WITHDRAWN` are distinct.

### The line status

New member **`FOOD_REMOVED`** on `lineResolutionStatusSchema`.

Both design authorities converged on the name independently. `FOOD_MISSING` was correct while the fact was an
_inference from absence_; under a tombstone it understates what we hold and sits one synonym from `NOT_FOUND`
("no wired source has it"), which is the discrimination failure `messages.ts:114` legislates against.
`FOOD_DELETED` overclaims — the row is retained. **One-way door**: it reaches i18n keys, both platforms and the
derived openapi.

### The warning

A **tile at the head of the Ingredients section** (below the `<h2>`, above the `<ul>`), plus a per-line badge.
Not page-top: a permanent data-quality caveat above the recipe title on every visit is crying wolf. Not in the
Nutrition section: this is primarily about the ingredient line.

**Warning tone, never error** — nothing failed and the recipe still cooks. `charcoal` on a `warning` tint, never
`warning` as a text colour.

**The load-bearing sentence is the reassurance**: _"Its name and amount in this recipe are unchanged."_ A cook's
real fear on seeing a warning inside their recipe is "is my recipe broken?", and answering that in the same
breath is what turns an alarm into information.

| Count       | Tile                                                             | Badges                                                         |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 1           | **names the ingredient** — a complete answer, no scanning needed | on that line                                                   |
| 2+          | counts, and points: "They're marked in the list"                 | on each                                                        |
| all (n ≥ 2) | "Every ingredient here…"                                         | **suppressed** — a badge on every row is wallpaper, not signal |

**⛔ Name the recipe's LINE, never the food record.** `RecipeIngredientView.name` is already on the wire
(`z.string().min(1)`). Under ruling 7 only the author can reference their own food, so the entitlement question
is largely moot — but the rule stands because a recipe can be public and viewed by someone else, and
`RESOLVED_UNAVAILABLE` exists precisely to give that viewer the line's name and nothing of the catalog row.

**⛔ `role="note"`, NOT `role="status"`/`aria-live`.** SC 4.1.3 governs content appearing _without a change of
context_; this is present on initial render of a freshly loaded page, where a live region either announces
nothing or duplicates content reached in document order. The sibling `reviewNotice` already made this call. RN
has no `note` role — follow whatever `RecipeDetailBody.native.tsx` already does for `reviewNotice`; do not
invent a third approach.

**No dismiss** (the condition is permanent; dismissal implies resolution) and **no inline re-link picker** (no
shortlist exists; it would duplicate the editor on a read surface). Owner action is navigation to the editor,
and its **absence** is what makes it owner-only — a callback prop, not an `isOwner` boolean.

Copy keys `removedFood*` on `RecipeDetailMessages`; three separate strings, never one template with a number
("English pluralization is not a substitution"). Passive voice deliberately — the actor is another user and
naming them discloses that an identifiable person stands behind the record.

### Platform translation (§14 / §3.6)

Web and mobile ship together. The action moves: inline at the end of the tile on web (precise pointer, eye
finishes there), **full-width at the bottom of the tile on mobile** (thumb reach, removes wrap risk on the
longest translated label). Everything else is kept.

**⛔ 320 px is a merge condition, and there is a pre-existing defect here.** The native ingredient row is
`flexDirection: 'row'` with **no `flexWrap`**; badges are `flexShrink: 0` and the name is `flexShrink: 1` — so
badges are protected and the **name** is what gets squeezed. Adding a fourth badge worsens it. Required
behaviour: at 320 CSS px with a 24-character name and **both** `Custom` and the status badge present, the name
renders at least two whole words, nothing clips, and the page does not scroll horizontally (WCAG 1.4.10). If the
trailing slot cannot satisfy that, the badge wraps to its own line beneath the name. Also verify the **singular**
tile with a 60-character name at **+35%** expansion.

The same defect affects the three shipped badges (`needsReview`, `ambiguous`, `unavailable`). **Flagged, not
fixed here** — changing shipped behaviour needs its own sign-off.

## ⛔ The riskiest thing in this plan: cross-database migration ordering

`packages/services/recipe-service/src/database/migrations/0001_initial.sql:85`:

```sql
CONSTRAINT "ingredients_food_resolution_status_check"
    CHECK ("food_resolution_status" IN ('PENDING','UNRESOLVED','RESOLVED','NOT_FOUND','FAILED'))
```

This is the **same constraint** whose staleness shipped a production 500 when U9 added `AWAITING_RETRY` to
food's enum and left it untouched — recorded in `foodStatusTranslation.ts`'s own docstring.

The recipe CHECK must admit `WITHDRAWN` in a release **strictly before** food can emit it. That is ADR-0035's
expand-first rule spanning **two databases and two deploy pipelines**.

```
1. recipe: CHECK widened, DEPLOYED           ← must be live before step 2 ships
2. food:   enum value + dedup index + deleteAuthored + macro withholding
3. recipe: read-path overlay + line status + UI
4. recipe: route removal (GET /ingredients/food-references/{foodId}) — a release later
```

**Getting 1 and 2 the wrong way round reproduces the U9 defect, and it passes every unit test.** This brings
`prodDeployMigrationOrder`, `dbTouchingStackBarrier` and ADR-0035's schema-stack ordering into scope, which an
earlier draft said were unaffected.

## Blast radius — guards

| Guard                                                                                                 | Affected                                                        |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `contractDriftGate`, `contractGenerationRunner`                                                       | **Yes**, both directions — regenerate both schema packages      |
| `errorEnvelopeParity`                                                                                 | **Yes** — food loses two codes; client classes move in lockstep |
| `foods.schema.test.ts` partition assertion                                                            | **Yes** — by design; widen to three arms                        |
| `prodDeployMigrationOrder`, `dbTouchingStackBarrier`                                                  | **Yes** (was "no" before soft delete)                           |
| `crossServiceLinkageJob`                                                                              | **Verify** — may exercise the delete/reference path             |
| `boundariesRatchet`, `infrastructureManifest`                                                         | **Yes** — food drops a dependency and an env var                |
| `crossAppImportClosure`, `deployVerificationCoverage`, `appServiceDependency`, `erasureSweepCoverage` | No                                                              |

## Test tiers (§7.1)

**Unit (TDD red first):** `foodPresenceStatus` truth table (live `WITHDRAWN` → `FOOD_REMOVED`; unreachable →
persisted status **unchanged**; private-to-another → `RESOLVED_UNAVAILABLE`, proving overlay order);
`FOOD_REMOVED` parses on the line schema and is **rejected** by the catalog schema; `deleteAuthored` authorizes
without any reference call; the three-arm partition; `removedFood*` model functions including
`allLinesFoodRemoved([]) === false`.

**Integration — must cross the real boundary:**

- Recipe detail against a real booted app + real food client where food answers `200` with `status:
'WITHDRAWN'` → line reports `FOOD_REMOVED`, `isComplete === false`, **no macros counted**.
- **The same read with food unreachable → the line's status is unchanged.** The single most important
  assertion in the change.
- Food: withdraw a food while a recipe references it → `204`; **assert no outbound HTTP to any recipe origin**
  (a stub that fails the test if hit); the row and its children survive; the author can re-add the same name.
- **Migration tiers, both databases** — assert the widened recipe CHECK and the food enum against a real
  database. A unit test cannot observe a migration that did not apply.

**Component:** every state on both platforms — normal, single (named), multiple, all, owner, non-owner, empty.

**E2E (deployed only, ADR-0032):** Playwright on `recipe-pr-{N}` — author a food, bind it, withdraw it, reload,
see the treatment. Maestro equivalent under §14 lockstep. Both skip when the sandbox is down; a skip is
reported as a skip.

**Not owed:** k6 (no new load shape).

## ADRs

**Amend ADR-0029 §9.** Soft delete makes the voluntary path _consistent_ with §6's delete-or-orphan erasure arm
rather than contradicting it, so the asymmetry an earlier draft raised **dissolves**. Two clauses: the reference
check and its fail-closed posture are removed; tombstone-**first** becomes tombstone-**only**, with a distinct
terminal `WITHDRAWN` rather than the in-flight `DELETING`.

**New ADR — "A withdrawn food is a published status, and recipe reads it live rather than inferring it."**
Decision: food withdraws rather than destroys and publishes `WITHDRAWN`; recipe translates it through the
existing ACL and overlays it at read, never writing on the read path. **Record the rejected alternative
properly** — hard delete plus absence inference from `unknownIds` was fully designed and is the shape someone
will re-propose; it fails because absence conflates _asked-and-disowned_ with _could-not-ask_, and because a
hard delete destroys the name the cook needs to be told about. Consequences: unbounded storage with no sweep;
the `addByFoodId` mirror staleness mitigated not closed; edge-cache lag; a pg enum value Postgres cannot remove.

**New ADR — "Authored foods are author-only; promotion is removed."** Decision, and what is deliberately left
behind (the unreachable `promoted` visibility value) so the restriction can be lifted without a migration.

## ⛔ OWED AFTER THIS PLAN — a feature spec for food promotion

**Status: open. Not part of this plan's scope; blocked on nothing but the owner's word to start.**

Ruling 7 removes promotion _for now_, not forever: _"we will provide them a way to request that their food
gets published globally later, or lift the restriction wholesale later when we can sort other concerns about
custom foods out."_ Change A executes the removal; it does **not** answer what replaces it, and nothing in
this plan does.

So a **feature spec for food promotion** is owed once this plan lands. What it has to decide — and what this
plan deliberately did not:

- **Author-requested vs. system-detected.** The removed machinery was system-detected (cross-author
  corroboration triggered a moderation candidacy and the author was never asked). Ruling 7 describes an
  author _requesting_ publication. Those are different features with different consent stories, and the
  second is not the first with a button added.
- **Or no promotion at all** — "lift the restriction wholesale" is the other half of the ruling, and a spec
  that concludes authored foods simply become world-readable is a legitimate outcome.
- **What "other concerns about custom foods" are**, stated rather than implied. They gate the whole feature
  and are currently unwritten.
- **Moderation.** Whether a human reviews, on what criteria, and who carries it. The removed design put an
  operator CLI on it and explicitly deferred a UI, leaving that surface unowned.
- **The Sybil bar.** The removed design's answer was corroboration by distinct tenured authors, with a
  rejection fingerprint barring identical resubmission. A request-based flow has no such bar by
  construction and needs its own.
- **What a published food does to recipes already bound to it**, and to the withdrawal path this plan
  builds — promotion and withdrawal are the same row's two directions.

### What this plan deliberately left standing so the spec is not blocked on a migration

- The **`promoted` visibility value** is still valid on the column and its CHECK, unreachable by any code
  path. Postgres cannot remove an enum value; leaving this one admissible means the restriction can be
  lifted without a data migration. See Change A.
- The **`food_promotions` table** (migration 0015) survives with no reader. Its DROP is a contracting
  migration and ADR-0035 ships those a release after the code stops reading them — so it is owed
  separately, and the spec should rule on whether it is dropped or re-adopted before that happens.

⚠️ Do **not** treat the deleted code as the spec. It answered the system-detected question, which is not the
question ruling 7 asks; git history is the record of a rejected shape, not a head start.

## Open items and residual risk

- **Edge cache lag, unresolved.** Food's `/api/v1/foods/nutrition` is CloudFront-cached on URL alone
  (ADR-0020). A withdrawal is invisible to cached responses until TTL. Either the TTL is short enough to be a
  stated lag, or an invalidation is owed. **Decide explicitly** — a stale `RESOLVED` served from the edge is the
  lazy detection failing silently.
- **`addByFoodId` short-circuits** on a stale `RESOLVED` mirror without asking food. Author-scoped under
  ruling 7 and self-correcting on the next refresh, so the reconciler is **deferred, not cancelled**.
- **Storage grows unbounded** until the sweep (explicitly out of scope).
- **Verify before coding:** that no row is currently `visibility = 'promoted'`, and that recipe holds no
  `scope='global'` mapping with `surfacing='promotion'`.
- **Verify:** that `applyMigrations` wraps each file in a single transaction (splitting the enum migration is
  harmless either way).
- **`NOT_FOUND` and `FAILED` render nothing** on recipe detail today — a terminally broken line is silent.
  Pre-existing, adjacent, not fixed here.
- **The deleting author's confirm dialog** is now where honest disclosure belongs. `FoodReferencedError`
  already carries `total` and `ownRecipeIds` — data that was the payload of a refusal and becomes the payload
  of a warning. Under ruling 7 those recipes are all the author's own, so the disclosure is entitled and cheap.
  **Separate spec**; arguably worth more than the tile, because it lets the person causing the loss decide not
  to.
