# CP-8 — Recipe-Service Remediation (S-R1, S-R2, S-R4–S-R8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the recipe-service architecture/quality findings from the 2026-07-18 adversarial review (master plan W10-b): atomize the non-transactional collection writes with a Unit-of-Work seam (S-R1), fix `restore`'s escaping snapshot failure (S-R2), collapse the 3× row→domain mapper (S-R4), tie the shadowed schema enums to recipe-core (S-R5), batch the N+1 ingredient resolution (S-R6), restore the validation framework seam in the collections controller (S-R7), and unify the pagination envelope (S-R8). (S-R3, the predicate module, is already done.)

**Architecture:** NestJS recipe-service over Drizzle/PG16. All DALs share ONE global `DrizzleProvider` (`'RECIPE_DRIZZLE_CONNECTION'`, a single `pg.Pool`), and cross-DAL transaction threading already works (`RecipesDal.create` opens `this.db.transaction` and threads the `tx` into `linkDal.replaceForRecipe(tx, …)`). CP-8 generalizes that into a reusable UoW seam and applies DRY/perf/correctness fixes. Fixes are backend; each carries **unit AND integration** tests (services mandate); the atomicity fixes (S-R1/S-R2) get integration tests proving no-orphan / restore-succeeds-on-snapshot-failure.

**Tech Stack:** NestJS 11, Drizzle ORM + PostgreSQL 16, zod, class-validator (existing controller pipes). Vitest (unit/integration/e2e), Docker Postgres + LocalStack integration harness. Node 24.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Master-plan fidelity:** the fixes are those specified in master plan W10-b. Where this plan and the master differ, the master governs; surface conflicts rather than silently diverging.
- **S-R1 UoW seam type = the transaction handle itself, NOT the narrow `Writer` Pick.** The seam must support `.execute` (the advisory-lock photo path `pg_advisory_xact_lock` and `SET TRANSACTION ISOLATION LEVEL` need it) — the current `type Writer = Pick<RecipeDrizzle,'insert'|'select'|'update'|'delete'>` omits `execute`/`transaction`. Define one shared UoW/tx type (the Drizzle tx handle) and unify the 3 divergent Writer copies (`recipes.dal.ts:170`, `photos.dal.ts:42` identical; `recipeIngredients.dal.ts:39` omits `'update'`).
- **S-R1 reference = food-service `mergeAndPersist.service.ts`** (`asDaoDb(tx)` narrowing + per-tx DAO/write construction) AND the existing `RecipesDal.create` tx-threading (DAL methods accept a `tx`). Promote INCREMENTALLY — no big-bang rewrite. Preserve `previewMembershipIds`'s read-only tx as-is.
- **S-R2 fix = best-effort snapshot (the master's test intent: "restore still reports SUCCESS, history reconciles via the outbox").** Route restore's snapshot through the ratified best-effort swallowing convention (`RecipesService.recordSnapshot`'s try/catch-and-log) so a snapshot-write failure does NOT 500 after the recipe already mutated. Do NOT make restore atomically ROLL BACK on a snapshot failure (that would fail the restore — the opposite of the intended semantics).
- **S-R7 fix = a reusable `ZodValidationPipe` (KEEP Zod), NOT a rewrite to class-validator DTOs.** The master explicitly says "keep Zod, restore the framework seam," and DA5 heads toward Zod schema-composition. The S-R7 complaint is that `collections.controller` calls `parseOrThrow(zod, body)` in handler BODIES instead of a pipe — fix by moving the existing Zod schemas into a `ZodValidationPipe implements PipeTransform` (the framework seam), not by converting to class-validator (churn DA5 would reverse).
- **No behavior change on the DRY refactors (S-R4/S-R5/S-R8):** collapsing the mappers / tying the enums / unifying pagination must produce byte-identical DTO output (S-R8 standardizes on the CORRECT `hasMore` — see its task). Prove no wire-contract drift.
- **Pattern-first (CLAUDE.md §Design-pattern-first):** S-R1 = Unit-of-Work; S-R4 = Data Mapper (single canonical); S-R7 = Pipe (framework validation seam); S-R8 = a shared helper. Name the pattern in JSDoc/PR.
- **TDD (§7.1):** failing test BEFORE code. Backend non-UI → unit AND integration. S-R1/S-R2 atomicity → integration (real DB) proving the invariant (no orphan / restore-succeeds). No new HTTP surface → no new k6.
- **Standards:** backend kebab `name.type.ts`; named exports; strict TS, zero `any` (the food-service `asDaoDb` uses `as unknown as` at the tx-narrowing boundary — that ONE documented cast is the accepted seam pattern; do not spray casts); no `@ts-ignore`; `import type`; custom errors extend `Error` + `Object.setPrototypeOf` + `is*` guard.
- **Node 24:** prefix commands with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`. From `packages/services/recipe-service`: unit `npx vitest run <path>`; integration `npx vitest run --config vitest.integration.config.ts <path>` (Docker PG; specs `describe.skipIf(!hasDatabaseUrl)` — run if available, else author + CI-note); e2e `... --config vitest.e2e.config.ts`.

## Inheritance manifest (current state — from the CP-8 scout)

- **S-R1:** `cloneCollection` (`collections/collections.service.ts:276-311`) = `dal.create` then a loop of N `dal.addRecipe(clone.id, recipe.id, CLONE_SEED)` (`:307`), each its own txn. `pullFromSource` (`:336-368`) = loop `dal.addRecipe(…, PULL)` (`:356`) + `dal.touchLastPulled` (`:362`). `CollectionsDal` has NO write transaction (only `previewMembershipIds` read-only tx, `:286`). Writer copies: `recipes.dal.ts:170`, `photos.dal.ts:42`, `recipeIngredients.dal.ts:39` (omits `update`). Tx-threading precedent: `recipes.dal.ts:197,239,487`. Advisory-lock/isolation needing `.execute`: `photos.dal.ts:61`, `recipes.dal.ts:285`. Reference: `food-service/src/foods/merge/mergeAndPersist.service.ts:39,92-94,138-148`.
- **S-R2:** `VersionsService.restore` (`versions/versions.service.ts:168-253`) — `recipes.update(…, {recordSnapshot:false})` commits (`:199-230`), then un-swallowed `this.createSnapshot(…)` (`:238-246`). Best-effort convention: `RecipesService.recordSnapshot` (`recipes/recipes.service.ts:474-498`, try/catch-and-log around `this.versions.createSnapshot`).
- **S-R4:** 3 mappers — `search/dal/search.dal.ts` `rowToRecipe` (`:186-232`) + its `RECIPE_COLUMNS` (`:57-64`) + `RawRecipeSearchRow` (`:119-152`) [26-col × 3]; `collections/collections.service.ts` `toRecipe` (`:76-123`); `recipes/recipes.service.ts` `toRecipeResponse` (`:137-205`). `collections/dal/collections.dal.ts:261` already derives via `getTableColumns(recipes)`.
- **S-R5:** `database/schema/recipes.ts:42-53` re-declares `RECIPE_VISIBILITIES`/`RECIPE_SOURCE_TYPES`/`RECIPE_DIFFICULTIES` (+ same-named type exports) shadowing recipe-core (`recipe.types.ts:27,49,67,92`). Fix pattern demonstrated: `database/schema/account.ts:30` (`as const satisfies readonly ErasureJobStatus[]`).
- **S-R6:** `RecipesService.resolveIngredientLines` (`recipes/recipes.service.ts:567-594`) serial `ingredientsDal.findById` per line. Batch method exists + used: `IngredientsDal.findByIds` (`ingredients/dal/ingredients.dal.ts:195`), used by `assembleNutritionLines` (`recipes.service.ts:413-419`).
- **S-R7:** `collections/collections.controller.ts` `parseOrThrow(zod, body)` (`:48-56`) in handlers (`:67,79,104,128,149,183`). Siblings use `@UsePipes(new ValidationPipe({transform,whitelist}))` (`recipes.controller.ts:39`, +6). No existing `ZodValidationPipe`. Schemas: `collections/collections.schemas.ts` (Zod).
- **S-R8:** envelope sites — `recipes.service.ts:642` (`hasMore: page*pageSize < total`), `search.service.ts:55` (same), `collections.service.ts:155` (`hasMore: offset + rows.length < total` — the CORRECT-on-short-page one). Clamps only in `search.dal.ts` (`clampPageSize`/`clampPage`, `:235-250`; `DEFAULT=20`/`MAX=50`).
- **Harness:** integration `__tests__/integration/**/*.integration.test.ts` (`vitest.integration.config.ts`, `fileParallelism:false`); `describe.skipIf(!hasDatabaseUrl)`. Atomicity-test precedents: `__tests__/integration/photos/reorder.integration.test.ts:79`, `account/erasure.integration.test.ts:304`.

---

### Task 1: S-R1 — Unit-of-Work seam + atomize `cloneCollection` and `pullFromSource`

**Files:**

- Create: `packages/services/recipe-service/src/database/unitOfWork.ts` (or `common/`) — a shared UoW type + a `withTransaction` helper. Define `type RecipeTx = Parameters<Parameters<RecipeDrizzle['transaction']>[0]>[0];` (the tx handle — supports `insert/select/update/delete/execute/…`). Optionally `withTransaction<T>(db, fn: (tx: RecipeTx) => Promise<T>): Promise<T> = db.transaction(fn)`. Unify the 3 `Writer` copies to one shared type that INCLUDES `execute` (so advisory-lock/isolation paths compile) — either replace `Writer` with `RecipeTx` where DAL methods accept a tx, or widen the shared `Writer` to include `'execute'`. Keep it a minimal, incremental promotion.
- Modify: `collections/dal/collections.dal.ts` — `create`, `addRecipe`, `touchLastPulled` accept an OPTIONAL tx (default `this.db`) so they can enlist in a UoW; add a **bulk** membership insert `addRecipes(collectionId, recipeIds, addedVia, tx?)` (ONE insert of N rows) to replace the per-recipe loop (kills the N+1 too).
- Modify: `collections/collections.service.ts` — `cloneCollection` = `withTransaction(db, tx => { create(…, tx); addRecipes(clone.id, seedRecipeIds, CLONE_SEED, tx); })` (one tx). `pullFromSource` = the `diff.added` bulk-insert + `touchLastPulled` in one tx. Preserve the read-only `previewMembershipIds`/preview outside the write tx.
- Modify (unify Writer): `recipes/dal/recipes.dal.ts`, `photos/dal/photos.dal.ts`, `recipes/dal/recipeIngredients.dal.ts` — converge on the shared UoW/Writer type (include `execute`; recipe-ingredients regains `update` if the shared type has it — confirm it doesn't break its narrower use).
- Test: `collections/dal/__tests__/collections.dal.test.ts` (unit — bulk insert), `__tests__/integration/collections/cloneCollection.integration.test.ts` + `pullFromSource.integration.test.ts` (atomicity).

- [ ] **Step 1: Write the failing integration test (atomicity) — mirror `photos/reorder.integration.test.ts`:** clone a source with N members but INJECT a mid-seed failure (e.g. one recipe id that violates a constraint, or a spy that throws on the 2nd insert) → assert NO orphan collection row AND no partial memberships survive (the whole clone rolled back). Same for `pullFromSource` (a mid-pull failure leaves lastPulledAt + memberships unchanged). (These FAIL today — the current code half-commits.)
- [ ] **Step 2: Run — expect FAIL** (partial rows survive).
- [ ] **Step 3: Implement** the UoW type/helper + the DAL tx-accepting methods + bulk insert + the service refactor to one tx each. Unify the Writer copies.
- [ ] **Step 4: Run integration — expect PASS**; add/keep a unit test for the bulk `addRecipes` (N rows in one statement).
- [ ] **Step 5:** run the FULL collections + recipes + photos suites (the Writer unification must not regress the recipe/photo write paths — esp. the advisory-lock photo create + the ingredient replace). Confirm green.
- [ ] **Step 6: Commit** — `fix(recipe-service): unit-of-work seam; atomize cloneCollection and pullFromSource in one transaction`.

---

### Task 2: S-R2 — `restore` snapshot best-effort (stop the snapshot failure escaping)

**Files:**

- Modify: `versions/versions.service.ts` `restore` — wrap the post-update `createSnapshot(…)` (`:238-246`) so a snapshot-write failure is SWALLOWED + logged (matching `RecipesService.recordSnapshot`'s convention), so `restore` still returns success (the recipe update already committed). Extract/reuse the swallowing pattern (a shared best-effort helper if clean, or an inline try/catch-and-log identical to `recordSnapshot`).
- Test: `versions/__tests__/versions.service.test.ts` (unit) + `__tests__/integration/versions/*.integration.test.ts` if the harness supports it.

- [ ] **Step 1: Failing unit test:** `restore` where `createSnapshot` throws → `restore` STILL RESOLVES success (returns the restore result, the recipe update took effect) and the error is logged, NOT rethrown (no 500). (Fails today — the throw escapes.) Also: the happy path still records the snapshot (a snapshot IS written when createSnapshot succeeds).
- [ ] **Step 2: FAIL → Step 3: Implement** the best-effort swallow around restore's snapshot.
- [ ] **Step 4: PASS**; run the versions suite + the restore e2e (`tests/e2e/version-*.e2e.test.ts`) to confirm the happy restore still records history.
- [ ] **Step 5: Commit** — `fix(recipe-service): route restore snapshot through the best-effort convention so a snapshot failure does not 500`.

---

### Task 3: S-R4 — One canonical `recipeRowToDomain` Data Mapper

**Files:**

- Create: a canonical mapper (`recipes/mappers/recipeRowToDomain.ts` or `recipe-core`-adjacent) `recipeRowToDomain(row): Recipe` encoding the shared field rules ONCE (`description ?? ''`, `prepTimeMinutes ?? 0`, `usesPremiumCapability`, `averageRating`/`leadCaloriesPerServing`/`authorHandle` omit-when-null, dates→ISO).
- Modify: `collections/collections.service.ts` `toRecipe` → delegate to the canonical mapper; `recipes/recipes.service.ts` `toRecipeResponse` → build the RecipeResponse superset ON TOP of the canonical mapper (it adds ingredients/steps/photos/nutrition — keep those, share the base fields). `search/dal/search.dal.ts` `rowToRecipe` → share the domain field-rules where feasible. NOTE: the search projection is over a RAW snake_case CTE (FTS/rank stays raw — do NOT force `getTableColumns` on it); if the raw row can be normalized to the canonical mapper's input shape cheaply, do so; else share only the field-rule LOGIC (extract the null-omit/coercion helpers) so the rules aren't triply maintained. Reduce `search.dal`'s 26-col `RECIPE_COLUMNS`/`RawRecipeSearchRow`/`rowToRecipe` triple-maintenance where possible (derive the projection or centralize the shape).
- Test: `recipes/mappers/__tests__/recipeRowToDomain.test.ts` (unit — every field rule, mutation lens) + confirm the 3 call sites produce byte-identical output (the existing collections/recipes/search tests must stay green).

- [ ] **Step 1: Failing unit test** for `recipeRowToDomain` (each field rule: null→omit, coercion, usesPremiumCapability, ISO dates). Then a characterization assertion that the 3 call sites' output is unchanged.
- [ ] **Step 2: FAIL → Step 3: Implement** the canonical mapper + delegate the 3 sites.
- [ ] **Step 4: PASS** — full recipes/collections/search suites green (NO DTO drift — this is the acceptance: byte-identical projections).
- [ ] **Step 5: Commit** — `refactor(recipe-service): single canonical recipeRowToDomain mapper (was 3x)`.

---

### Task 4: S-R5 — Tie the schema enum sets to recipe-core (stop the shadow)

**Files:**

- Modify: `database/schema/recipes.ts:42-53` — either IMPORT the value arrays from recipe-core, or apply `as const satisfies readonly <RecipeCoreType>[]` to each (`RECIPE_VISIBILITIES satisfies readonly RecipeVisibility[]`, etc.) so a drift from recipe-core fails the build. Reconcile the same-named type re-exports (`RecipeVisibility`/`RecipeSourceType`/`RecipeDifficulty`) — prefer re-exporting recipe-core's types (or aliasing) so there's ONE authoritative type. Update the schema's CHECK-constraint consumers if the arrays move.
- Do the same for the analogous shadows the master names (collections/ingredients/account enum sets) if they have the same shadow pattern — check + tie them.
- Test: a compile-time/type test (a `satisfies`/assignment test) proving the schema set equals recipe-core's; the existing schema tests stay green.

- [ ] **Step 1: Failing test** (or a deliberate drift check): assert the schema's `RECIPE_VISIBILITIES` set-equals recipe-core's `RecipeVisibility` values (a unit test comparing the arrays), so a future divergence is caught. (Or rely on the `satisfies` making it a compile error — then a type-level test.)
- [ ] **Step 2: FAIL/compile-check → Step 3: Implement** the `satisfies`-tie / import-from-recipe-core + reconcile the type re-exports.
- [ ] **Step 4: PASS** — schema + all consumers typecheck (monorepo tsc) + tests green.
- [ ] **Step 5: Commit** — `refactor(recipe-service): tie schema enum sets to recipe-core (satisfies) to stop silent drift`.

---

### Task 5: S-R6 — Batch the ingredient-line resolution (kill the N+1)

**Files:**

- Modify: `recipes/recipes.service.ts` `resolveIngredientLines` (`:567-594`) — replace the serial per-line `findById` loop with a batch: dedupe ids → `ingredientsDal.findByIds(ids)` → Map → validate each line against the Map (preserve the fail-fast `unknownIngredient(id)` on a missing id, in the ORIGINAL line order). Mirror `assembleNutritionLines` (`:413-419`).
- Test: `recipes/__tests__/recipes.service.test.ts` (unit — batch called ONCE, `unknownIngredient` still thrown for a missing id, order preserved) + the create/update integration paths stay green.

- [ ] **Step 1: Failing unit test:** resolving M lines calls `findByIds` ONCE (not M `findById`) — assert the batch call + that `findById` is NOT looped; a missing id still throws `unknownIngredient(id)`; the resolved order matches the input line order. (Fails today — it loops findById.)
- [ ] **Step 2: FAIL → Step 3: Implement** the batch + Map lookup + fail-fast.
- [ ] **Step 4: PASS** — recipes create/update/clone/restore suites green (the resolution feeds all).
- [ ] **Step 5: Commit** — `perf(recipe-service): batch ingredient-line resolution (findByIds) to remove the write-path N+1`.

---

### Task 6: S-R7 — `ZodValidationPipe` (restore the framework seam in collections)

**Files:**

- Create: `packages/services/recipe-service/src/common/pipes/zod-validation.pipe.ts` — `class ZodValidationPipe<T> implements PipeTransform` taking a `ZodType<T>`, `transform(value)` = `schema.safeParse` → on failure throw `BadRequestException(issues.map(i => i.message))` (identical error shape to the current `parseOrThrow`), else return the parsed data. Named export + JSDoc naming the Pipe pattern.
- Modify: `collections/collections.controller.ts` — replace the in-handler `parseOrThrow(schema, body)` calls with the pipe: `@Body(new ZodValidationPipe(createCollectionSchema)) body: CreateCollectionBody` (and `@Query(new ZodValidationPipe(listSchema))` etc.) per route; delete the local `parseOrThrow` helper. Keep the existing Zod schemas (`collections.schemas.ts`) — they're the pipe's input.
- Test: `common/pipes/__tests__/zod-validation.pipe.test.ts` (unit — valid input returns parsed; invalid throws `BadRequestException` with the issue messages) + the collections controller tests stay green (same validation behavior, now via the pipe) + a controller test that a bad body → 400.

- [ ] **Step 1: Failing pipe unit test:** `ZodValidationPipe(schema).transform(valid)` → parsed data; `.transform(invalid)` → throws `BadRequestException` with the zod issue messages. (Pipe doesn't exist → fail.)
- [ ] **Step 2: FAIL → Step 3: Implement** the pipe + rewire the 6 collections handlers + delete `parseOrThrow`.
- [ ] **Step 4: PASS** — collections controller unit + integration + e2e green (validation behavior identical, now at the framework seam).
- [ ] **Step 5: Commit** — `refactor(recipe-service): ZodValidationPipe restores the framework validation seam in collections`.

---

### Task 7: S-R8 — Shared pagination envelope helper (unify + fix `hasMore`)

**Files:**

- Create: a shared `toPageEnvelope`/`buildPageEnvelope({ rows/results, total, page, pageSize })` + shared `clampPage`/`clampPageSize` (promote from `search.dal`) in `common/pagination.ts` (or recipe-core-adjacent). Use the CORRECT `hasMore` formula — `offset + rows.length < total` (the collections one; correct on a short final page) — as the single formula. Keep `data`/`results` key naming per each caller (recipes/collections use `data`, search uses `results` + `facets` — the helper builds the common `{ total, page, pageSize, hasMore }` and the caller wraps its rows key).
- Modify: `recipes/recipes.service.ts:642`, `search/search.service.ts:55`, `collections/collections.service.ts:155` — build the envelope via the helper (standardizing `hasMore` on the correct formula). Move the search clamps into the shared helper; apply clamping consistently where a service currently relies only on DTO validation (document if recipes/collections should also clamp — match existing behavior unless the DTO already clamps).
- Test: `common/__tests__/pagination.test.ts` (unit — `hasMore` correct on a FULL last page AND a SHORT final page AND an empty result; clamps) + the 3 services' list tests stay green (assert the envelope shape unchanged EXCEPT where the corrected `hasMore` differs — if any test asserted the OLD `page*pageSize<total` on a short page, update it to the correct value + note the correctness fix).

- [ ] **Step 1: Failing unit test:** `toPageEnvelope` → `hasMore` is FALSE on the exact-last-full-page and on the short-final-page (total=25,pageSize=10,page=3,rows=5 → false), TRUE when a next page exists; clamps enforce `[1,MAX]`. (Helper doesn't exist → fail.)
- [ ] **Step 2: FAIL → Step 3: Implement** the helper + rewire the 3 sites onto the correct formula.
- [ ] **Step 4: PASS** — recipes/search/collections list unit + integration green; confirm the corrected `hasMore` doesn't break a legitimate consumer expectation (the frontend infinite-query uses `hasMore`).
- [ ] **Step 5: Commit** — `refactor(recipe-service): shared pagination envelope helper with the correct hasMore formula`.

---

## Self-review (author checklist — completed)

- **Spec coverage:** S-R1 (Task 1), S-R2 (Task 2), S-R4 (Task 3), S-R5 (Task 4), S-R6 (Task 5), S-R7 (Task 6), S-R8 (Task 7). S-R3 already done. Ordering: HIGH atomicity first (S-R1 seam, S-R2 best-effort — independent of each other), then the MED/LOW DRY/perf items.
- **Decisions resolved in-plan:** S-R1 UoW type = the tx handle (incl execute), unify the 3 Writers, bulk insert; S-R2 = best-effort swallow (restore succeeds, per the master's test), NOT atomic-rollback; S-R7 = ZodValidationPipe (keep Zod per the master), NOT class-validator conversion; S-R4 = canonical mapper, search's FTS raw CTE stays raw (share field-rule logic, don't force getTableColumns); S-R8 = the correct `offset+rows.length<total` formula everywhere.
- **No wire drift:** S-R4/S-R8 must produce identical DTOs (except S-R8's corrected `hasMore` on a short final page — a documented correctness fix). Integration/e2e prove no regression.
- **No placeholders:** exact files, the exact seam/mapper/pipe/helper shapes, the exact test invariants (no-orphan, restore-succeeds, batch-once, correct-hasMore), acceptance signals.
