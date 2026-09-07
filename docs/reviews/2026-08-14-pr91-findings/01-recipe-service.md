# 01 — Recipe service + the recipe import path (REVIEW)

**Scope**: `packages/services/recipe-service/**`, `packages/services/recipe-workers/**`,
`packages/clients/recipe-service/**`, `packages/schemas/recipe/**`, `packages/shared/recipe-core/**`,
plus the food-service edges the import path will traverse.
**Branch**: `chore/code-quality-enforcement-phase-1-2` (working tree clean at `4a979422`).
**Governing decisions read first**: `CLAUDE.md`, `docs/CODING_STANDARDS.md` §7/§7.1/§9/§15/§15.2/§15.4,
ADR-0011, ADR-0014, ADR-0015, ADR-0017 (incl. the 2026-08-14 amendment), ADR-0019,
`specs/004-recipe-importing/spec.md` (FR-046..FR-051, FR-011/FR-012 reassignment, D-001 superseded).

---

## Areas that are SOUND — stated plainly, so the findings below are not read as a verdict on the whole

These were examined and found correct. They are not filler; each is a place a reviewer would expect a
defect and there is none.

- **Contract ownership (ADR-0014 / GR-015) holds end to end.** All ten authored `*.schema.ts` files under
  `packages/services/recipe-service/src/` are published; I diffed every generated copy in
  `packages/schemas/recipe/src/schemas/` against its authored source (banner stripped) and all ten are
  byte-identical — **no hand-edited generated file**. `CONTRACT_HASH` is identical in
  `packages/services/recipe-service/src/contract/contract-hash.ts:19` and
  `packages/schemas/recipe/src/contract-hash.ts:19` (`85cd9cd0…`). `packages/schemas/recipe/package.json`
  declares only `@kitchensink/recipe-core` + `zod` — the leaf carries no server graph.
- **The client declares ZERO wire shapes.** Every type in
  `packages/clients/recipe-service/src/types.ts` is an alias of, or an indexed access into, a
  `@kitchensink/schema-recipe` type. The only local declarations across `client.ts`/`hooks.ts`/`queries.ts`
  are genuinely client-side (`RecipeServiceClientOptions`, `QueryEnableOptions`, `RawResponse`,
  `RatingMutationContext`) — verified by enumerating every top-level `interface`/`type` in those files.
  Both directions are parsed at the boundary (`client.ts:1194` `expect`, `client.ts:1229` `request`).
- **Optimistic concurrency on `PATCH /recipes/{id}` is a real CAS**, not a read-then-check:
  `recipes.dal.ts:465` puts `eq(recipes.currentVersion, input.expectedVersion)` in the `WHERE`, and
  `recipes.service.ts:708-713` converts a 0-row match into the same enriched `409`.
- **`sql.raw` has been eliminated** from `recipe-service` and `recipe-workers` (ADR-0015 §7): the only
  surviving references are in tests that _red_ if it comes back
  (`search/dal/__tests__/search.dal.test.ts:358`, `recipe-workers/src/handlers/__tests__/raw-sql-parameterization.test.ts`).
- **Provenance mass-assignment (004-FR-025) is structurally impossible today.** `createRecipeRequestSchema`
  (`recipes.schema.ts:111-160`) is a `z.strictObject` with no `sourceType`/`sourceUrl`/`sourceAttribution`
  member, so a caller that sends one gets a `400`; `RecipesService.create` never reads such a field.
- **`evaluateVisibility` already satisfies ADR-0019 §1's "Visitor intent, add no machinery".**
  `recipes/domain/visibility-policy.ts:59-89` is two `switch`es over `RecipeSourceType` with no `default`
  and no fallthrough return, so adding a `sourceType` member is a compile error. Nothing to add.
- **The erasure path is the right precedent for ADR-0019 §5** (durable row first, message as a
  notification, sweeper backstop): `account/erasure.service.ts:205-256`. Reuse this shape for the import
  spine rather than inventing one.
- **`recipe-workers` parses every SQS payload at the boundary** (ADR-0015 §3) via
  `recipe-workers/src/common/messages.schema.ts`, and the `z.object`-vs-`strictObject` choice is reasoned
  in place (lines 17-21).
- **Test tiers are genuinely wired in CI**, not merely present: `_ci.yml` calls recipe-service integration
  (`:520`), recipe-workers integration (`:631`), recipe-service-client integration (`:671`), recipe-service
  e2e (`:813`), plus the `contract-drift` job (`:253`). k6 lives in the `_ci-heavy.yml` tier (`:9-10`).
- **`packages/schemas/recipe` having no `lint`/`test` script is DELIBERATE, not a gap** — it is recorded
  exemption 3 in `packages/infra/global/__tests__/static-analysis-coverage.test.ts:66-75`, and typecheck is
  explicitly _not_ exempted. Do not "fix" it.

---

## F-R1

**Severity**: HIGH
**File**: `packages/services/recipe-service/src/ingredients/ingredients.service.ts:61-68` (`nutrientPer100g`)
and `:127-136` (`extractNutrition`)

**What breaks**
An ingredient's persisted per-100g nutrition can be silently wrong — by ~4.184× for calories — and the
wrong value is written into the **ownerless, shared** `ingredients` catalog for every user, then
denormalized into `recipes.lead_calories_per_serving` at write time (`recipes.service.ts:488`, `:513`,
`:648-655`) so it is baked into every list/search/collection card.

Concrete input → wrong behaviour:

1. Food-service returns a golden record whose `nutrients` array contains **two `Energy` rows** — one
   `{ nutrient: 'Energy', unit: 'kcal' }` and one `{ nutrient: 'Energy', unit: 'kJ' }`. `extractNutrition`
   asks for the first `per_100g` entry whose lowercased **name** contains `energy` and ignores `unit`
   entirely. If the kJ row comes back first, `caloriesPer100g` is stored as kilojoules.
2. `fatGPer100g` matches `name.includes('lipid') || name.includes('fat')`. **`'Fatty acids, total saturated'`
   lowercases to `'fatty acids, total saturated'`, which contains `'fat'`.** If a fatty-acid row precedes
   `'Total lipid (fat)'` — or if the food has fatty-acid rows and no total-lipid row — `fatGPer100g` becomes
   saturated fat.
3. `carbsGPer100g` matches `includes('carbohydrate')`, which `'Carbohydrate, by difference'` and
   `'Carbohydrate, other'` both satisfy.

**Why it happens**
Three facts compose into an order-dependent read across a service boundary:

- The wire type **carries the unit and the code never reads it**:
  `packages/schemas/food/src/schemas/foods.schema.ts:77-88` declares `unit` and `basis` on `NutrientView`;
  `extractNutrition` filters on `basis` and never on `unit`.
- Food's nutrient dictionary is keyed on **`(name, unit)`** —
  `packages/services/food-service/src/db/schema/food.ts:191`
  (`unique('nutrient_name_unit_unique').on(table.name, table.unit)`) — so `Energy/kcal` and `Energy/kJ` are
  two distinct dictionary rows, and `food_nutrients` is unique on `(food_id, nutrient_id)`
  (`food.ts:226`), which permits a single food to carry both.
- Food's golden-record read has **no `ORDER BY`**:
  `packages/services/food-service/src/foods/dao/food.dao.ts:436-447` selects `food_nutrients` joined to
  `nutrient` with only a `WHERE`. Array order is therefore heap order, which changes after an UPDATE, a
  VACUUM, or a plan change. So the same food can yield kcal today and kJ tomorrow.

The fixtures hide it: `src/ingredients/__fixtures__/ingredients.fixtures.ts:120-125` and
`src/ingredients/__tests__/ingredients.service.test.ts:56` each contain exactly **one** `Energy` row (kcal)
and no `Fatty acids…` row, so every existing nutrition test passes whether or not the matcher is correct.

**Smallest fix**
Make the unit part of the match, and anchor the fat matcher. In `ingredients.service.ts`:

```ts
function nutrientPer100g(
    nutrients: readonly FoodView['nutrients'][number][],
    matches: (name: string) => boolean,
    unit: string,
): number | undefined {
    const hit = nutrients.find(
        (n) => n.basis === 'per_100g' && n.unit.toLowerCase() === unit && matches(n.nutrient.toLowerCase()),
    );
    return hit?.amount;
}
```

then `caloriesPer100g: nutrientPer100g(n, (name) => name.includes('energy') || name.includes('calorie'), 'kcal')`
and `'g'` for the other three, and change the fat predicate to
`(name) => name.includes('lipid') || /\bfat\b/u.test(name)` so `'fatty'` no longer matches. Add a fixture
carrying both `Energy` rows and a `'Fatty acids, total saturated'` row — that fixture alone reds the current
code.

**Verified (how)**
Read all four files cited. Confirmed `nutrientPer100g` uses `Array.prototype.find` over a caller-supplied
name-only predicate. Confirmed `unit` is on the published food wire shape and unused in recipe. Confirmed
the `(name, unit)` dictionary key and `(food_id, nutrient_id)` uniqueness in food's drizzle schema. Confirmed
`readGoldenRecord` has no `orderBy` (`rg -n "orderBy" food.dao.ts` → no match). Confirmed every recipe-side
nutrition fixture carries a single unambiguous energy row.

---

## F-R2

**Severity**: HIGH
**File**: `packages/services/recipe-service/src/ingredients/ingredients.service.ts:470-491` (`resolve`,
converge-only guard at `:484-486`) with `src/ingredients/dal/ingredients.dal.ts:363-385` (`updateResolution`)

**What breaks**
The invariant the method's own docstring calls "a cross-user data-integrity defect" if violated —
_"an already-`RESOLVED` ingredient is returned unchanged … without calling the food service or writing"_ —
is enforced by a **read-then-act with no compare-and-swap**, so it does not hold under concurrency.

Input → wrong behaviour: user A and user B both disambiguate the same shared `UNRESOLVED` ingredient row
(the catalog is ownerless by design, data-model R5). Both requests load the row at `:475` and observe
`UNRESOLVED`. Both pass the guard at `:484`. Both call
`foodClients.standard(caller).resolve(foodId, candidateIds)` at `:488` with **different** candidate picks,
and both then `refreshStatus` and write through `updateResolution`. Whichever write lands second wins,
overwriting the food link and golden-record nutrition the other user's resolution produced — for every user
of that catalog row. That is exactly the outcome the guard was written to prevent.

The same absence bites the poll path: `updateResolution` sets `food_resolution_status` unconditionally
(`ingredients.dal.ts:374`) while `COALESCE`-ing the nutrition columns (`:375-379`). Two concurrent
`GET /api/v1/ingredients/{id}/status` polls where one observes `PENDING` and the other `RESOLVED` can leave
the row `PENDING` **with** populated nutrition — a state no single caller can produce — which then defeats
`addByFoodId`'s "already settled and nourished" short-circuit at `:279-285` and costs an extra food
round-trip on every subsequent pick.

**Why it happens**
`resolve`'s guard reads state into the process and acts on it later; nothing in the SQL re-checks it. The
package already knows this pattern is required — `createFoodBacked`/`createFreeform` are made race-proof by
a unique constraint plus re-select, and that is proven against real Postgres in
`__tests__/integration/ingredients/dedup.integration.test.ts:70-95`. The _resolution_ half never got the
same treatment. The only test of the guard,
`src/ingredients/__tests__/ingredients.service.test.ts:328`, drives a mocked DAL sequentially, so it passes
whether or not the invariant survives concurrency.

**Smallest fix**
Move the converge-only rule into the write. In `updateResolution`, refuse to leave a settled resolution:

```sql
WHERE id = ${id}
  AND (${input.foodResolutionStatus} = 'RESOLVED' OR food_resolution_status <> 'RESOLVED')
```

and have `resolve` treat an `undefined` return (0 rows matched) as "someone else settled it — re-read and
return that row". Add an integration case in the existing
`__tests__/integration/ingredients/disambiguation.integration.test.ts` that fires two `resolve` calls
concurrently against one `UNRESOLVED` row and asserts exactly one food-client `resolve` took effect.

**Why this matters beyond today**: ADR-0019 §4 requires supersession decided by _"a monotonic sequence
carried in the envelope, not by arrival order"_, and 004-FR-051 requires idempotent ingestion. `ingredients`
is the table that will carry FR-050's shell/placeholder status. A last-write-wins status column is the
precise mechanism ADR-0019 says _"silently reverts `succeeded` to `processing` on a redelivery."_ Fixing it
now is fixing the substrate the spine needs.

**Verified (how)**
Read `resolve`, `refreshStatus`, `addByFoodId` and `updateResolution` in full. Confirmed the UPDATE's only
predicate is `WHERE id = ${id}`. Confirmed `COALESCE` on the four nutrition columns and the portions column
means a status-only write never clears them. Grepped the ingredient test tiers for concurrency: the only
`Promise.all` races cover _inserts_ (`dedup.integration.test.ts`) and _credential isolation_
(`food-token-forwarding.integration.test.ts:253`) — nothing races `resolve` or `updateResolution`.

---

## F-R3

**Severity**: HIGH
**File**: `packages/services/recipe-service/src/ingredients/ingredients.controller.ts:80-93` (`parseLimit`),
`:115-129` (`search`), `:158-173` (`suggest`)

**What breaks**
Two published endpoints do not enforce the query contract this service publishes for them, and answer with
a failure code the service's own error enum does not contain.

The contract exists: `src/ingredients/ingredients.schema.ts:186-191` authors
`ingredientSearchQuerySchema` (`q: z.string().min(1)`, `limit: z.coerce.number().int().positive().optional()`),
it is copied into `@kitchensink/schema-recipe`, and it is named as the shared bag for both routes at
`ingredients.schema.ts:28-30`. The controller **never uses it**. It takes `@Query('q')`/`@Query('limit')` as
raw strings and hand-rolls the parse.

Input → wrong behaviour:

- `GET /api/v1/ingredients/search?q=flour&limit=-5` → `parseLimit` returns `-5` (`Number.isFinite(-5)` is
  `true`), no rejection; `clampLimit` (`dal/ingredients.dal.ts:123-129`) silently turns it into `1`. The
  published contract says `.positive()`, i.e. a `400`. Same for `limit=2.7` (contract says `.int()`;
  `clampLimit` truncates).
- `GET /api/v1/ingredients/search?q=` → `400` with `code: 'BAD_REQUEST'` and **no `details.fields`**.
  `BAD_REQUEST` is deliberately absent from `recipeErrorCodeSchema`
  (`src/common/api-error.schema.ts:96-154`; the reasoning is at
  `packages/shared/nest-error-envelope/src/envelope.ts:98-103`), so the typed client's
  `recipeApiErrorSchema` narrowing **rejects** it and the consumer degrades to status-only mapping —
  losing the field-level detail the document promises for a boundary rejection.

**Why it happens**
ADR-0015 decision 1 requires _"One mechanism per service: `createZodDto` + `nestjs-zod`'s
`ZodValidationPipe`, covering bodies, path params, **query params**"_, and decision 2 bans the per-method
hand-rolled parse. Every sibling controller complies — `search.controller.ts:45`,
`collections.controller.ts:83`, `recipes.controller.ts:69` all take a `createZodDto` query DTO. Ingredients
is the sole holdout, and `src/ingredients/dto/` contains no query DTO at all (only the three body DTOs).

**This is a known defect class that was already diagnosed and fixed once, and missed here.**
`src/search/search.schema.ts:52-62` records the identical failure for `GET /api/v1/search/recipes` in its
own words — _"this route's `400` missed `ApiExceptionFilter`'s validation branch and published `BAD_REQUEST`
… while the published document promised `VALIDATION_FAILED` … One endpoint out of forty-one spoke a
different dialect."_ Two more endpoints still speak it.

**Smallest fix**
Add `src/ingredients/dto/ingredient-search.query.dto.ts`:

```ts
export class IngredientSearchQueryDto extends createZodDto(ingredientSearchQuerySchema) {}
```

and change both handlers to `@Query() query: IngredientSearchQueryDto`, deleting `parseLimit` and both
`BadRequestException` throws. The controller-scoped `@UsePipes(ZodValidationPipe)` at `:100` already runs.
Move the existing `ingredients.controller.test.ts:78-117` assertions from `BadRequestException` to a driven
pipe so they red if the DTO is removed.

**Verified (how)**
Read the controller, `ingredients.schema.ts`, `clampLimit`, `api-error.schema.ts`, `envelope.ts`, and
`search.schema.ts`'s post-mortem. `rg -n "@Query\(" src` over non-test sources confirms ingredients is the
only controller using the string-key form. `ls src/ingredients/dto/` confirms no query DTO exists.

---

## F-R4

**Severity**: MED
**File**: `packages/services/recipe-service/src/recipes/recipes.service.ts:667-674`

**What breaks**
The same user error — publishing a recipe with no ingredients or no steps — produces **two different wire
contracts** depending on whether the client resent the arrays, and one of them is untested.

- `PATCH /api/v1/recipes/{id}` with `{ status: 'published', expectedVersion: N, ingredients: [] }` →
  the schema refinement at `recipes.schema.ts:194-204` fires → `400 VALIDATION_FAILED` with
  `details.fields: ['ingredients: A published recipe needs at least one ingredient.']`.
- `PATCH /api/v1/recipes/{id}` with `{ status: 'published', expectedVersion: N }` against a stored **empty
  draft** → the schema cannot judge it (it does not carry what is stored, as `recipes.schema.ts:191-193`
  states), so `recipes.service.ts:672` throws
  `new BadRequestException('A published recipe needs at least one ingredient and one step.')` →
  `400 BAD_REQUEST` with **no `details.fields`**.

`BAD_REQUEST` is not a member of `recipeErrorCodeSchema` (`src/common/api-error.schema.ts:96-154`), so the
typed client's `recipeApiErrorSchema` narrowing rejects it. A client that branches on
`VALIDATION_FAILED` to highlight the offending field handles the first case and falls through on the second.

**Why it happens**
The schema half and the service half of one rule were implemented with two different error mechanisms. The
service half also has **zero test coverage in any tier**: the message string
`'A published recipe needs at least one ingredient and one step.'` appears only in `recipes.service.ts` and
nowhere under `src/recipes/__tests__/`, `__tests__/integration/recipes/`, or `tests/e2e/` — so the branch
that guards "a draft may be empty but may not be published empty" is asserted by nothing (§7.1: unit AND
integration, both, for non-UI code).

**Smallest fix**
Raise the same coded failure the schema half raises. Use the service's own `apiError` helper
(`src/common/api-error.ts`, the one way to raise a coded failure) with `VALIDATION_FAILED` and
`details.fields` naming `ingredients` and/or `steps`, so both paths publish one code with one detail shape.
Add the missing unit test in `src/recipes/__tests__/recipes.service.test.ts` (empty stored draft +
`status: 'published'` with no arrays) and one integration case in
`__tests__/integration/recipes/crud.integration.test.ts`.

**Verified (how)**
Read `recipes.service.ts:660-706`, `recipes.schema.ts:179-204`, `api-error.schema.ts:96-154`, and
`nest-error-envelope/src/envelope.ts:343-357` (the normalization that turns a bare `BadRequestException`
into `codeForStatus(400) === 'BAD_REQUEST'`). Repo-wide `rg` for the message string returns only the schema
messages and the service throw — no test file.

---

## F-R5

**Severity**: HIGH (readiness blocker for ADR-0019, not a defect in shipped behaviour)
**File**: `packages/services/recipe-service/src/ingredients/food-service-clients.factory.ts:60-103`,
`packages/services/recipe-service/src/config/config.types.ts:403-411`

**What breaks**
ADR-0019's bulk import processor cannot call the food service. Every outbound food call in this service is
made **as the requesting user**, with that user's Clerk session token, and there is deliberately no service
credential:

> `config.types.ts:403` — *"**There is deliberately NO `FOOD_SERVICE_TOKEN`.** Food's `FoodAuthGuard` verifies
> a *Clerk* token, and a long-lived static env string cannot satisfy that verifier (session tokens live
> ~60s) … Recipe now forwards the CALLER's own verified token instead … so there is no service credential
> to configure here."*

`FoodServiceClients.standard`/`.typeahead` accept only a `CallerToken`, which
`auth/caller-token.decorator.ts` mints from the inbound `Authorization` header.

That decision is correct for what it governs — a synchronous, per-request, per-keystroke path. **ADR-0019
changes its stated premise.** 004-FR-020 requires ingredient names to be _"submitted to the food catalog
(003) for asynchronous resolution"_ and _"an unresolved ingredient MUST NOT block draft confirmation"_;
FR-048/FR-050 require work to continue after the HTTP request has returned `queued`. A ~60-second session
token cannot survive a 1,000-recipe import (FR-026), and persisting one to drive a background job would be
strictly worse than a machine credential.

**Why it happens**
The credential model was designed against the only cross-service caller that existed (the typeahead). The
answer already exists in the portfolio and is unbuilt on this side: `specs/003-usda-food-data/spec.md`
FR-047 / A-012 specifies a Clerk **machine (M2M) token** path _by name_, for _"internal jobs (recipe import
per FR-012 …)"_, verified on its own non-networkless path against `FOOD_AUTHORIZED_MACHINES`. Nothing in
`packages/services/recipe-service/src` mints or holds one (`rg -n "machine|m2m|M2M" src` returns only the
inbound service-erasure principal and the food-client docstrings).

**Smallest fix**
Do not weaken the caller-forwarding rule for interactive paths. Add a **second, named** factory method —
`FoodServiceClients.asService()` — backed by a `FOOD_SERVICE_MACHINE_TOKEN_SECRET_ARN` (or a Clerk M2M
minting client), reachable **only** from the import processor and never from a request-scoped handler, and
enforce that with the same package ESLint import restriction already applied to `revealCallerToken`
(`food-service-clients.factory.ts:29`). Record the amendment against `config.types.ts:403`'s "deliberately
NO token" note — that note must say _"no token on the interactive path; the import processor uses a machine
principal"_, or the next reader will delete the new one.

**⛔ HALT / blocking question**: whether recipe's import processor authenticates to food with a Clerk M2M
principal (003-FR-047's shape, which needs food's `FOOD_AUTHORIZED_MACHINES` allowlist populated and food's
secret-key verification path live) is a cross-service, one-way-door decision I cannot resolve from the repo.
It is stated under _Questions_ below rather than guessed at.

**Verified (how)**
Read the factory, `caller-token.ts`, `caller-token.decorator.ts`, `config.types.ts:385-444`, and
003-FR-047/A-012. `rg` over `packages/services/recipe-service/src` for machine/M2M finds no outbound
service-credential path.

---

## F-R6

**Severity**: MED (readiness)
**File**: `packages/services/recipe-service/src/ingredients/ingredients.service.ts:368-382` (`addByName`),
`packages/clients/food-service/src/client.ts:167` (`batch`, unused)

**What breaks**
Ingredient resolution for a bulk import is unbounded, sequential, per-name work against another service.
`addByName` performs **one** food-service HTTP call per ingredient name on the 8-second default budget
(`FoodServiceClients.standard`), and there is no batching, no concurrency bound, and no backpressure.

004-FR-026 permits **1,000 recipes per file**, and `MAX_RECIPE_INGREDIENTS` is **100**
(`packages/shared/recipe-core/src/recipeRequestBounds.ts:62`). A single import can therefore demand up to
100,000 individual food calls. At food's own `/api/v1/foods/batch` cap of 100 names per request, the same
work is ≤1,000 requests. The food client already exposes `batch(names)` and **nothing in the recipe service
calls it** — `rg -n "\.batch\(" packages/services/recipe-service/src packages/services/recipe-workers/src`
returns no match.

**Why it happens**
`addByName` was built for the interactive picker, where one call per user action is exactly right. ADR-0019
§1 routes every channel through one processor whose tail is _"validate, resolve ingredients to food
entities, create recipes"_ — that tail inherits `addByName`'s shape unless the processor is given a bulk
resolution primitive.

**Smallest fix**
Add `IngredientsService.admitManyByName(caller, names)` that de-duplicates the names, chunks them to food's
100-name cap, calls `foodClient.batch(chunk)`, and upserts through the existing race-proof
`createFoodBacked` path. Bound in-flight chunks (a small fixed concurrency, not `Promise.all` over
everything). Leave the single-name `addByName` untouched for the picker.

**Verified (how)**
Read `addByName`, `FoodServiceClients`, `packages/clients/food-service/src/client.ts:153-181`, FR-026 in
`specs/004-recipe-importing/spec.md:299`, and `recipeRequestBounds.ts:62`. Confirmed by grep that `batch` has
no caller in either recipe package.

---

## F-R7

**Severity**: MED (readiness)
**File**: `packages/services/recipe-workers/src/common/messages.schema.ts` (whole file);
`packages/services/recipe-service/contract/config.ts:55-64`

**What breaks**
ADR-0019's _Required by this ADR_ clause says the status envelope _"and its supersession key are **one
contract**, authored once and generated into the schema package per ADR-0014"_. There is currently **no
place in `recipe-workers` where such a contract can be authored and published.** The generator
(`@kitchensink/contract-gen`) is configured against one service root — `contract/config.ts:15-21` points at
`packages/services/recipe-service` — and `recipe-workers` has no `contract/` directory, no
`contract:generate` script, and no `@kitchensink/schema-recipe` dependency (`recipe-workers/package.json`).
Its existing `messages.schema.ts` is authored, correct, and **unpublished**; the file says so itself at
lines 23-28 (_"IDEAL HOME, NOT YET AVAILABLE"_).

Concrete consequence: if the status emitter lands in `recipe-workers`, the envelope 014's consumer must
parse (ADR-0019: _"Consumers parse status messages at the boundary with zod"_) is a type no consumer can
import — reproducing exactly the two-independent-representations failure ADR-0014 §Context measured.

**Why it happens**
The generator's unit is a **service**, and the queue-message contract's producer/consumer pair currently
sits inside one non-service package. This was fine while every message stayed in-package; ADR-0019 makes one
of them cross-service.

**Smallest fix**
Author the status envelope as a `*.schema.ts` under **`packages/services/recipe-service/src/`** (e.g.
`src/import/import-status.schema.ts`), where the existing generator already discovers, guards and publishes
it into `@kitchensink/schema-recipe` with no new machinery, and have `recipe-workers` import it from the
schema package. This costs nothing and satisfies ADR-0019's clause exactly. Note that
`contract/config.ts:55-64` records `EXCLUDED_FILES` as deliberately empty and asserts it in
`contract/__tests__/contract.test.ts` — so the day a _non-wire_ `*.schema.ts` appears in the service, that
test forces the exclusion decision rather than defaulting it. That mechanism is already correct; use it.

**Verified (how)**
Read `contract/config.ts`, `contract/generate.ts`, `@kitchensink/contract-gen`'s `generateSchemaPackage`
(`packages/tools/contract-gen/src/generate.ts:186-285`), `recipe-workers/package.json`, and
`recipe-workers/src/common/messages.schema.ts`. Confirmed `discoverAuthoredSchemas` walks
`config.serviceRoot` only, and that no second generator config exists (`git ls-files packages/services/recipe-workers`
shows no `contract/`).

---

## F-R8

**Severity**: LOW
**File**: `packages/services/recipe-service/src/ingredients/ingredients.service.ts:291-307`

**What breaks**
`addByFoodId` can regress an already-`RESOLVED` shared catalog row back to a non-terminal status.

Input → wrong behaviour: an ingredient row is `RESOLVED` but has **no** `caloriesPer100g` (a legitimate
state — a food whose golden record carries no energy nutrient, which F-R1's matcher also produces on a
miss). The "already settled and nourished" short-circuit at `:279-285` requires _both_ `RESOLVED` **and**
`caloriesPer100g !== undefined`, so it does not fire. `readFoodStatus` is called; if food transiently
answers `PENDING` (a re-fetch in flight, FR-028a reactivation), `resolved === undefined` and line `:296`
writes `foodResolutionStatus: 'PENDING'` onto a row that was `RESOLVED`. The picker then shows "nutrition
pending" for every user of that shared row until someone polls again.

**Why it happens**
The advance-an-existing-row branch was written for the "brand-new pick vs. existing row" split and does not
distinguish _advancing_ a non-terminal row from _regressing_ a terminal one.

**Smallest fix**
Guard the advance: only write the observed status when the existing row is **not** already `RESOLVED` —
i.e. `if (existing !== undefined && existing.foodResolutionStatus !== FoodResolutionStatus.RESOLVED)`. The
`updateResolution` predicate proposed in F-R2 fixes this site as a side effect, which is the better
single change.

**Verified (how)**
Read `addByFoodId` in full including the short-circuit condition at `:279-285` and the advance branch at
`:295-301`, plus `updateResolution`'s unconditional status write.

---

## F-R9

**Severity**: LOW
**File**: `packages/services/recipe-service/src/ingredients/food-catalog.gateway.ts:36`,
`food-service-clients.factory.ts:46`, `ingredients.service.ts:34`, `ingredients.controller.ts:51`,
`auth/caller-token.ts`

**What breaks**
Five files in the ingredients vertical carry `@implements FR-007 FR-047` with a **bare** FR id. `FR-047`
there means **003**'s FR-047 (service-to-service auth,
`specs/003-usda-food-data/spec.md:492`). As of 2026-08-14, `004-FR-047` exists and means _"every import
channel MUST terminate in one bulk import processor"_ — a different requirement, about the **same service**
and the **same ingredient-resolution path**. A reader implementing ADR-0019 who opens
`food-catalog.gateway.ts` to find the FR-047 seam resolves the citation to the wrong requirement.

`specs/004-recipe-importing/spec.md:12-18` already records this collision class and mandates the fix:
_"Every cross-feature reference MUST use the `004-` prefix … matching `../cross-feature-FR-index.md`"_ (that
index file exists).

**Why it happens**
The citations predate 004's FR-046..FR-051 block, which was added on 2026-08-14.

**Smallest fix**
Prefix them: `@implements 001-FR-007 003-FR-047` (and the same for `FR-007a`) in the five files. Pure
docstring edit, no behaviour change.

**Verified (how)**
`rg -n "@implements" packages/services/recipe-service/src` enumerated the five sites. `rg -n "FR-047" specs/`
confirmed the two definitions and that 003's is the one these files mean. Confirmed
`specs/cross-feature-FR-index.md` exists.

---

## F-R10

**Severity**: LOW
**File**: `packages/services/recipe-service/src/recipes/recipes.service.ts:459-463`,
`packages/services/recipe-service/src/versions/versions.service.ts:256`

**What breaks**
The two best-effort version-snapshot failure paths log with bare `console.error`, while the rest of the
service uses Nest's `Logger` (`main.ts`, `common/filters/api-exception.filter.ts:123`,
`account/erasure.service.ts`, `ingredients/food-catalog.gateway.ts:81`, `photos/photos.service.ts`,
`photos/cdn-invalidation.ts`). The comment at `:461-462` states the intent — _"Surface it for observability
(logs route to Sentry) without propagating"_ — but a bare `console.error` emits neither Nest's `ERROR`
level token nor the `[Context]` tag. Any severity classifier that reads the message text (the shape used by
`packages/services/identity-webhooks/src/common/otlp.ts:122-132`, `/\b(error|fatal|exception)\b/i`) sees
`"Failed to record version snapshot for recipe <uuid>: …"`, which contains no such token, and classifies a
**silently lost version-history row** as INFO.

**Why it happens**
The two sites are the only ones in the service that swallow an exception, and they were written without a
`Logger` instance on the class.

**Smallest fix**
Add `private readonly logger = new Logger(RecipesService.name);` (and the same in `VersionsService`) and
replace both calls with `this.logger.error(message, error instanceof Error ? error.stack : String(error))`,
matching `ApiExceptionFilter.catch`'s existing shape at `api-exception.filter.ts:135-138`.

**Verified (how)**
`rg -n "console\.(error|warn|log)" src` over non-test sources returns exactly these two plus the CLI seed
script and the deliberately injected `erasure-metrics` sink. `rg -c "new Logger\("` enumerated the six
Logger users. Read `detectSeverity` in `otlp.ts`.

---

## ADR-0019 readiness — summary verdict

**The recipe service can host the bulk import processor, and three shapes must change first.**

| ADR-0019 clause                                                   | State today                                                                                                                                                                                                                                                                    | Blocked by                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| §1 one processor, `sourceType` per channel                        | **Ready.** `RecipeSourceType` is a 4-member union with exhaustive switches and no `default` (`visibility-policy.ts:59-89`) — Visitor intent already satisfied, add no dispatch machinery. `imported_physical` already exists, so 011 submits with no contract change (FR-047). | —                                             |
| §2 `sourceType` declared, never inferred; whitelisted server-side | **Ready.** `createRecipeRequestSchema` is `strictObject` with no provenance member, so mass-assignment is structurally impossible (FR-025).                                                                                                                                    | —                                             |
| §4 per-entity superseding status                                  | **Not ready.** No status envelope exists, and no package can publish one.                                                                                                                                                                                                      | F-R7                                          |
| §4 supersession by monotonic sequence, never arrival order        | **Not ready — and the substrate actively fights it.** `updateResolution` is unconditional last-write-wins.                                                                                                                                                                     | F-R2                                          |
| §5 placeholder + shell entry readable from the DB                 | **Mostly ready.** `ingredients.food_id` + `food_resolution_status` (`PENDING`/`UNRESOLVED`) is already the recipe-side placeholder FR-050 describes; the food side already models a pending food. Nothing to invent.                                                           | F-R2 (the status column must stop regressing) |
| §5 message is a notification of a committed change                | **Precedent exists.** `erasure.service.ts:205-256` is the durable-row-then-message-then-sweeper shape. Reuse it.                                                                                                                                                               | —                                             |
| Ingredient resolution at import scale                             | **Not ready.** One synchronous, user-credentialled food call per ingredient name.                                                                                                                                                                                              | F-R5, F-R6                                    |

---

## Not examined

Stated explicitly so nobody reads a gap here as a clean bill.

- **`packages/services/recipe-service/src/`**: the `photos`, `versions`, `ratings`, `collections`, `search`,
  `account/export`, `auth` and `health` verticals were read only where they intersect the import path or a
  finding above (error envelope, DAL patterns, contract generation). Their DALs, services and controllers
  were **not** audited line by line.
- **`packages/services/recipe-service/infra/`** and **`packages/services/recipe-workers/infra/`** — CDK
  stacks, the deployed smoke, and the ALB listener-priority allocation were not reviewed at all.
- **`packages/services/recipe-workers/src/handlers/*`** — I read `messages.schema.ts` and confirmed the
  boundary-parse discipline, but did **not** audit `archive-sweeper`, `version-archive-worker`,
  `account-erasure-worker`, `erasure-sweeper`, `erasure-orphan-sweeper` or `handle-sync-worker` for
  idempotency, partial failure or DLQ behaviour.
- **`packages/clients/recipe-service/src/hooks.ts` and `queries.ts`** (962 + 321 lines) — I verified they
  declare no wire shapes and read the query-key/mutation structure headers, but did **not** audit cache
  invalidation, optimistic-update rollback, or the disambiguation hooks.
- **`packages/shared/recipe-core/`** — I read `recipe.types.ts`'s `RecipeSourceType` and
  `recipeRequestBounds.ts`'s caps. `nutrition.ts`, `units.ts`, `recipeAccessPolicy.ts`,
  `accountErasure.ts`, `serviceErasureToken.ts`, `recipeObjectKeys.ts` and `ids.ts` were **not** reviewed.
  Note that `recipe-core` has a unit tier and **no** integration tier; §7.1 nominally requires both for
  non-UI code, but the package is a zero-I/O, zero-dependency (`zod` only) pure library, so I did not raise
  it as a finding — flagging it here as a judgement call rather than an omission.
- **`packages/schemas/recipe/openapi.yaml`** — I confirmed it is generated and that every `src/schemas/*.ts`
  copy matches its authored source byte for byte. I did **not** verify the 4,945-line document's route
  table, response-schema coverage, or `oasdiff` behaviour.
- **App-layer consumers** (`packages/apps/commise/**`) — outside the stated scope. I did not check whether
  any app file hand-declares a recipe wire shape.
- **Nothing was executed.** I ran no tests, no build, no `contract:generate` (the generator writes files and
  I am read-only by construction). The byte-for-byte generated-copy check was done with `diff` against the
  committed tree, which is a weaker gate than a real regeneration — it proves no hand-edit, not that the
  generator would reproduce it.
