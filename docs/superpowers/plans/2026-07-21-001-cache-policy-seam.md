# CP-5 — Cache / Policy Seam Implementation Plan (W9 step 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared cache-policy + authorization-policy seam the rest of W9 (and W3) sits on — a per-domain `queryOptions` factory module with an explicit staleTime/gcTime policy and a single projection-invalidation registry, a `recipe-core` Specification/Policy module with a `Viewer` value object and branded ids, and the write-through + optimistic-rating cache updates that delete the containers' hand-rolled bridge hacks.

**Architecture:** Read seams move from per-hook inline `queryFn`s to `queryOptions` **factories** (`recipeQueries(client).detail(id)`), so hooks become one-liners and Next.js server components can `prefetchQuery`. The projection set that a recipe write invalidates becomes one `recipeProjections(id)` **registry** co-located with those factories, closing the collection-embed staleness gap (DA2) by construction. Authorization/visibility/tier predicates become **pure functions over a `Viewer` value object** in `recipe-core`, replacing the per-platform ad-hoc `isOwner`/`canClone`/`canGoPrivate` computations. Ids become **branded** so the rating security gate can't silently transpose arguments. Mutation responses are **written through** to the cache (`setQueryData`) instead of discarded, and rating taps become **truly optimistic** (`onMutate`/`onError`/`onSettled`), deleting ~60 lines of `ratingOverride` bridge from the two detail containers.

**Tech Stack:** TypeScript (strict), `@tanstack/react-query` v5 (`queryOptions`, `useQuery`, `useInfiniteQuery`, `useMutation`, `QueryClient`), `zod` v4 (`.brand()`), Vitest + React Testing Library, npm workspaces + Turborepo. Packages touched: `@kitchensink/recipe-core` (`packages/shared/recipe-core`), `@kitchensink/recipe-service-client` (`packages/clients/recipe-service`), `@commise/web`, `@commise/mobile`, `@commise/features-recipes`.

## Global Constraints

_Copied verbatim from the master plan's Global Constraints + the CP-5 Inheritance manifest. Every task's requirements implicitly include this section._

- **TDD is mandatory, no exceptions:** write the failing test BEFORE the code it covers (red → green), per `docs/CODING_STANDARDS.md §7.1`. Non-UI code (this plan is almost entirely non-UI: domain fns, client hooks, cache policy) requires **unit tests AND integration tests — both**. A feature is not done until every category it touches has passing tests of every required kind.
- **Cross-platform rule:** any container change ships to BOTH web (`.tsx`) and mobile (`.native.tsx`) in the same task. Shared logic (policy, fixtures, factories, cache updates) lives in shared packages, never duplicated per platform.
- **Node 24 required:** prefix every command with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH` or vitest/husky hooks fail (the shell defaults to Node 18).
- **Conventional Commits**, enforced by commitlint: `<type>(<scope>): <subject>` — lowercase subject, body lines ≤ 100 chars. Footer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Formatting/lint:** 4-space indent, single quotes, semicolons, trailing commas, 120-char width (Prettier); `import type` for type-only imports; `.js` extension on aliased/cross-package imports, `.ts`/`.tsx` on relative; named exports only. Run `npm run format` + the package `lint` script before each commit.
- **TypeScript:** strict, zero `any`, no `@ts-ignore`/`@ts-expect-error`. Custom errors extend `Error` + `Object.setPrototypeOf` + an `is*` guard. Impure functions carry a `@sideEffect` JSDoc tag; all other functions are pure.
- **Pattern-first:** lead commit/PR descriptions with the design pattern (Repository read seam, Specification/Policy module, value object, registry, Command with optimistic update). Component/module JSDoc names the pattern it implements.
- **Decision-1 floor rule (verbatim):** the mockup is the **floor** — the code MUST render at least what the wireframe shows; retain any superior shipped affordance the mockup omits; never silently subtract shipped behavior. (No UI is added here, but this governs any incidental render change.)
- **Preserve these proven invariants (do NOT regress):** the nested query-key invalidation contract (searches deliberately live OUTSIDE the `recipes` prefix — staling search is always an explicit call); the collection **membership-write narrowness** (only collection mutations touch `collections` — this plan adds the REVERSE direction, recipe-writes → embed, and must not widen membership writes); `ratingModeFor`'s fail-safe ordering (absent viewer id ⇒ `rate`, never `own`); fail-**closed** while the profile loads (tier absent ⇒ not premium); `usesPremiumCapability` stays the SERVER-side badge derivation (a separate concern from the client authorization policy); the self-limiting `refetchInterval` on the ingredient-status poll; the single ref-stabilized client from `RecipeProviders`; the CAS-sensitive edit path stays **pessimistic** (no optimistic pre-write on `updateRecipe` — the 409 flow is the point).

---

## File Structure

**`packages/shared/recipe-core/src/` (P4, DA6, T1):**

- Create `ids.ts` — branded id value objects (`RecipeId`, `UserId`, `IngredientId`, `FoodId`, `S3Key`) + their zod schemas + smart constructors.
- Create `viewer.ts` — the `Tier` value object + `Viewer { id, tier }` type + `makeViewer`.
- Create `recipeAccessPolicy.ts` — pure authorization predicates `isOwner`/`canClone`/`canGoPrivate`/`canRate` over `(recipe, viewer)`.
- Create `testing/fixtures.ts` — the shared Object Mother (`makeRecipe`/`makeRecipeDetail`/`makeRecipeVersion`/`makeCollection`/`makeIngredient`), invariant-deriving.
- Create `testing/index.ts` — the `recipe-core/testing` barrel.
- Modify `index.ts` — re-export `ids`, `viewer`, `recipeAccessPolicy` (NOT `testing` — that is its own subpath).
- Modify `package.json` — add the `./testing` export subpath.

**`packages/clients/recipe-service/src/` (P5, DA2, DA3, DA4):**

- Create `queries.ts` — the `queryOptions` factory modules (`recipeQueries`/`collectionQueries`/`ingredientQueries`) built on `recipeServiceKeys`, carrying per-domain `staleTime`/`gcTime`, plus `recipeProjections(id)` (the invalidation registry, folding DA2) and both `list`/`infinite` variants.
- Modify `hooks.ts` — hooks consume the factories (one-liners); `invalidateRecipeProjections` delegates to `recipeProjections`; add write-through (`setQueryData`) to `updateRecipe`/`cloneRecipe`/`setRecipeVisibility`/`restoreRecipeVersion`; make the two rating hooks optimistic (`onMutate`/`onError`/`onSettled`).
- Modify `index.ts` — export the factory modules + `recipeProjections`.

**`packages/apps/commise/web/src/` + `packages/apps/commise/mobile/src/` (DA4, P5 consumers):**

- Modify `web/.../RecipeDetailContainer.tsx` + `mobile/.../RecipeDetailScreen.tsx` — delete the `ratingOverride` bridge (state + render-phase reset + `resolveSelectedStars` wiring); the optimistic hook now owns it. Adopt the `recipe-core` policy predicates for `isOwner`/`canClone`/`canGoPrivate`.
- (P5 server prefetch on the Next.js recipe pages is a follow-on consumer, tracked in B19/CP-9 — NOT in this plan; this plan only unblocks it by shipping the factories.)

**Profile (P5 profileQueries, B12):** `web/.../hooks/useUserProfile.ts` + the mobile peer — fold both hand-rolled profile reads onto a shared `profileQueries` factory. _Deferred note:_ the profile read belongs to identity, not recipe-service; per the master, B12's profile single-sourcing lands with the identity client work (CP-7/DA10). **This plan scopes `profileQueries` OUT** and leaves a one-line pointer — do not build it here (avoids a cross-service dependency the master sequences later).

---

## Task 1: DA2 — recipe writes invalidate collection embeds (correctness fix first)

**Why first:** smallest, highest-correctness, and it pins the behavior P5's registry must preserve. A soft-deleted or renamed recipe currently lingers stale inside `CollectionWithRecipes.recipes` because no recipe mutation touches any `collections` key.

**Files:**

- Modify: `packages/clients/recipe-service/src/hooks.ts:398-402` (`invalidateRecipeProjections`)
- Test: `packages/clients/recipe-service/src/__tests__/invalidation.test.ts` (create if absent; else add to the existing hooks/invalidation test)

**Interfaces:**

- Consumes: `recipeServiceKeys.collections` (existing prefix, `hooks.ts:100`).
- Produces: unchanged signature `invalidateRecipeProjections(queryClient, recipeId): void` — now also stales `collections`.

- [ ] **Step 1: Write the failing test.** Assert that invoking the recipe-projection invalidation stales the `collections` prefix. Use a real `QueryClient` and spy on `invalidateQueries`, or seed a `collection(id)` query and assert it is marked stale after a recipe write. Prefer the behavioral form:

```ts
import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { recipeServiceKeys } from '../hooks.js';
// If invalidateRecipeProjections is not exported, export it (module-internal → named export) as part of this task.
import { invalidateRecipeProjections } from '../hooks.js';

describe('invalidateRecipeProjections (DA2)', () => {
    it('stales the collections prefix so recipe writes refresh collection embeds', () => {
        const client = new QueryClient();
        const spy = vi.spyOn(client, 'invalidateQueries');

        invalidateRecipeProjections(client, 'rec_1');

        const invalidatedKeys = spy.mock.calls.map((call) => call[0]?.queryKey);
        expect(invalidatedKeys).toContainEqual(recipeServiceKeys.recipe('rec_1'));
        expect(invalidatedKeys).toContainEqual(recipeServiceKeys.recipeLists);
        expect(invalidatedKeys).toContainEqual(recipeServiceKeys.recipeSearches);
        // DA2 — the new one: a recipe write must also stale collection embeds.
        expect(invalidatedKeys).toContainEqual(recipeServiceKeys.collections);
    });
});
```

- [ ] **Step 2: Run it and watch it fail.** `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH; cd packages/clients/recipe-service && npx vitest run src/__tests__/invalidation.test.ts` — expect FAIL (`collections` not invalidated; and/or `invalidateRecipeProjections` not exported).

- [ ] **Step 3: Make it pass.** Export the helper and add the `collections` invalidation:

```ts
export function invalidateRecipeProjections(queryClient: ReturnType<typeof useQueryClient>, recipeId: string): void {
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipe(recipeId) });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeLists });
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.recipeSearches });
    // DA2 — a recipe's projection is embedded in CollectionWithRecipes.recipes; a recipe write (edit, delete,
    // restore, rating, visibility) must stale every cached collection so a renamed/removed member refreshes.
    void queryClient.invalidateQueries({ queryKey: recipeServiceKeys.collections });
}
```

Update the block comment above the function to name `collections` as the fourth region and why (embed). Update the `useCreateRecipe`/`useUpdateRecipe`/`useDeleteRecipe`/`useCloneRecipe`/`useSetRecipeVisibility` hooks that currently inline `recipes` + `recipeSearches` to ALSO cover collections — the simplest correct move is to route them through `invalidateRecipeProjections` where they already have the id (update/visibility/clone/delete return or carry the id); `createRecipe` has no id, so add an explicit `collections` invalidation there too (a new recipe can't already be a member, but keep the set uniform — OR document why create is exempt; prefer exempting create with a one-line comment, since a brand-new recipe is in no collection).

- [ ] **Step 4: Run tests + typecheck + lint.** `npx vitest run` (whole client package), `npx tsc --noEmit`, `npm run lint`. Expect PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/clients/recipe-service/src/hooks.ts packages/clients/recipe-service/src/__tests__/invalidation.test.ts
git commit -m "fix(recipe-client): recipe writes stale collection embeds (w9/da2)"
```

---

## Task 2: T1 — shared Object Mother fixtures via `recipe-core/testing`

**Why now:** the P4/P5/DA3/DA4 tasks below multiply hook/domain tests; sharing the pure-domain fixtures first prevents new fixture debt, and the invariant-**deriving** canonical implementation kills the two inline copies that hard-code `usesPremiumCapability`/`averageRating` literals (which can fabricate domain-illegal states).

**Scope (from the re-attack correction — do NOT over-share):** share ONLY the pure-domain wire-contract fixtures — `makeRecipe`, `makeRecipeDetail`, `makeRecipeVersion`, `makeCollection`, `makeIngredient` — with the invariant-deriving impl as canonical. The **client** package keeps its deliberate minimal-wire specialization (its tests assert exact wire round-trips; omitting optionals is the point) — leave it as a local factory, do NOT force it onto shared defaults. The **service** row-factories (Drizzle row types, `Date` objects) are a different layer — leave server-local.

**Files:**

- Create: `packages/shared/recipe-core/src/testing/fixtures.ts`, `packages/shared/recipe-core/src/testing/index.ts`
- Create: `packages/shared/recipe-core/src/testing/__tests__/fixtures.test.ts`
- Modify: `packages/shared/recipe-core/package.json` (add `./testing` export)
- Modify: consumers — replace the byte-identical `makeRecipe`/etc trio in `web/.../__fixtures__`, `mobile/.../__fixtures__`, `features/recipes/.../__fixtures__` with re-exports from `@kitchensink/recipe-core/testing`; delete the 2 inline copies (the ones inside test files, not in `__fixtures__/`).

**Interfaces:**

- Produces: `makeRecipe(overrides?: Partial<Recipe>): Recipe` (and peers), each `make*` deriving invariants (e.g. `usesPremiumCapability` is computed via the real `usesPremiumCapability(...)`, never a literal; `averageRating` absent iff `ratingCount === 0`).

- [ ] **Step 1: Write the failing test** for the deriving invariant (the reason to centralize):

```ts
import { describe, expect, it } from 'vitest';
import { RecipeVisibility, usesPremiumCapability } from '../../index.js';
import { makeRecipe } from '../fixtures.js';

describe('makeRecipe (T1 shared Object Mother)', () => {
    it('derives usesPremiumCapability from the recipe, never a hard-coded literal', () => {
        const priv = makeRecipe({ visibility: RecipeVisibility.PRIVATE });
        expect(priv.usesPremiumCapability).toBe(usesPremiumCapability(priv));
    });

    it('keeps averageRating absent exactly when ratingCount is 0 (no domain-illegal state)', () => {
        expect(makeRecipe({ ratingCount: 0 }).averageRating).toBeUndefined();
        expect(makeRecipe({ ratingCount: 3, averageRating: 4.5 }).averageRating).toBe(4.5);
    });
});
```

- [ ] **Step 2: Run it, watch it fail** (`fixtures.ts` does not exist). `cd packages/shared/recipe-core && npx vitest run src/testing/__tests__/fixtures.test.ts` → FAIL.

- [ ] **Step 3: Implement `fixtures.ts`.** Port the canonical (deriving) implementation from the existing feature `__fixtures__/index.ts` (the one that computes rather than hard-codes), generalized to accept `Partial<T>`. Each factory: sane defaults, spread overrides, then re-derive any invariant field so an override can't produce an illegal state. Export from `testing/index.ts`.

- [ ] **Step 4: Add the `./testing` export** to `recipe-core/package.json`:

```json
"exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
}
```

- [ ] **Step 5: Run the fixture test, watch it pass;** then migrate consumers one package at a time (web → mobile → features), re-exporting from `@kitchensink/recipe-core/testing`, running that package's suite after each swap. Delete the 2 inline in-test copies. Keep the client's local minimal-wire factory untouched.

- [ ] **Step 6: Full verify** — `npm run test`, `npm run typecheck`, `npm run lint` across the touched packages. Expect PASS with no assertion churn beyond the deleted copies.

- [ ] **Step 7: Commit.**

```bash
git add packages/shared/recipe-core/src/testing packages/shared/recipe-core/package.json packages/apps/commise/*/**/__fixtures__ ...
git commit -m "test(recipe-core): share pure-domain object-mother fixtures (w9/t1)"
```

---

## Task 3: P4 + DA6 — access-policy module, `Viewer` value object, branded ids

**Files:**

- Create: `packages/shared/recipe-core/src/ids.ts`, `viewer.ts`, `recipeAccessPolicy.ts` (+ `__tests__/recipeAccessPolicy.test.ts`, `__tests__/ids.test.ts`)
- Modify: `packages/shared/recipe-core/src/index.ts` (re-export the three)
- Modify (consumers, own commit): `web/.../RecipeDetailContainer.tsx`, `mobile/.../RecipeDetailScreen.tsx`, `HomeWidgetSurface.tsx` tier mapping — adopt `makeViewer` + the predicates; unify the two tier vocabularies (`['free','pro']` widget ladder vs `'premium'` gate) onto the one `Tier` VO.

**Interfaces:**

- Produces:
    - `type Tier = 'free' | 'premium'` + `tierSchema` + `rankTier(tier): number` (free < premium) — the single tier authority.
    - `interface Viewer { readonly id?: UserId; readonly tier: Tier }` + `makeViewer(params: { id?: string; subscriptionTier?: string }): Viewer` (maps identity's `subscriptionTier` → `Tier`, fail-closed to `free`).
    - `isOwner(recipe: Pick<Recipe,'ownerId'>, viewer: Viewer): boolean` — true iff `viewer.id !== undefined && viewer.id === recipe.ownerId`.
    - `canRate(recipe, viewer): boolean` — `!isOwner && viewer.id !== undefined` (the `ratingModeFor` gate, now shared + branded).
    - `canClone(recipe: Pick<Recipe,'visibility'|'ownerId'>, viewer): boolean` — `recipe is public && !isOwner` (fixes D7: web/mobile disagreed).
    - `canGoPrivate(viewer): boolean` — `rankTier(viewer.tier) >= rankTier('premium')`.
    - Branded ids in `ids.ts`: `RecipeId = z.string().min(1).brand<'RecipeId'>()` (+ `UserId`/`IngredientId`/`FoodId`/`S3Key`) with `type RecipeId = z.infer<...>` and a `recipeId(raw: string): RecipeId` smart constructor.

- [ ] **Step 1: Write the failing policy test** — pin the security-relevant branches with the mutation lens (a transposed/absent id must NOT grant ownership or cloning):

```ts
import { describe, expect, it } from 'vitest';
import { RecipeVisibility } from '../../index.js';
import { makeViewer } from '../viewer.js';
import { isOwner, canClone, canRate, canGoPrivate } from '../recipeAccessPolicy.js';

const recipe = { ownerId: 'usr_owner', visibility: RecipeVisibility.PUBLIC } as const;

describe('recipeAccessPolicy (P4)', () => {
    it('is not owner when the viewer id is absent (fail-safe, never masquerade)', () => {
        expect(isOwner(recipe, makeViewer({}))).toBe(false);
    });
    it('is owner only on an exact id match', () => {
        expect(isOwner(recipe, makeViewer({ id: 'usr_owner' }))).toBe(true);
        expect(isOwner(recipe, makeViewer({ id: 'usr_other' }))).toBe(false);
    });
    it('lets a non-owner clone a public recipe but never the owner (fixes D7 web/mobile disagreement)', () => {
        expect(canClone(recipe, makeViewer({ id: 'usr_other' }))).toBe(true);
        expect(canClone(recipe, makeViewer({ id: 'usr_owner' }))).toBe(false);
        expect(canClone({ ...recipe, visibility: RecipeVisibility.PRIVATE }, makeViewer({ id: 'usr_x' }))).toBe(false);
    });
    it('rates iff the viewer can see it and does not own it', () => {
        expect(canRate(recipe, makeViewer({ id: 'usr_other' }))).toBe(true);
        expect(canRate(recipe, makeViewer({ id: 'usr_owner' }))).toBe(false);
        expect(canRate(recipe, makeViewer({}))).toBe(false);
    });
    it('gates private-visibility on the premium tier, failing closed when tier is unknown', () => {
        expect(canGoPrivate(makeViewer({ id: 'u', subscriptionTier: 'premium' }))).toBe(true);
        expect(canGoPrivate(makeViewer({ id: 'u', subscriptionTier: 'free' }))).toBe(false);
        expect(canGoPrivate(makeViewer({ id: 'u' }))).toBe(false);
    });
});
```

- [ ] **Step 2: Write the failing branded-id test** — argument transposition must be a compile error, and the smart constructor validates:

```ts
import { describe, expect, it } from 'vitest';
import { recipeId, userId, isRecipeId } from '../ids.js';

describe('branded ids (DA6)', () => {
    it('constructs and guards a RecipeId', () => {
        const id = recipeId('rec_1');
        expect(isRecipeId(id)).toBe(true);
        expect(String(id)).toBe('rec_1');
    });
    it('rejects an empty id at the boundary', () => {
        expect(() => recipeId('')).toThrow();
    });
    // Compile-time proof (documented, not executed): a function taking (RecipeId, UserId) rejects a
    // transposed call `fn(userId('u'), recipeId('r'))` — a bare-string version type-checks silently today.
});
```

- [ ] **Step 3: Run both, watch them fail;** then implement `ids.ts`, `viewer.ts`, `recipeAccessPolicy.ts` per the Interfaces block. Keep every predicate pure and total. Re-export from `index.ts`.

- [ ] **Step 4: Run recipe-core suite + typecheck + lint** → PASS. Commit the `recipe-core` half:

```bash
git commit -m "feat(recipe-core): access-policy module + viewer vo + branded ids (w9/p4,da6)"
```

- [ ] **Step 5 (consumer adoption, separate commit):** in `RecipeDetailContainer.tsx` + `RecipeDetailScreen.tsx`, build one `Viewer` per platform via `makeViewer` (web from Clerk `external_id` + profile tier; mobile from `profile.user.id` + profile tier — unifying the two id sources P4 flagged), and replace the local `isOwner`/`isPublic && !isOwner` clone gate / `subscriptionTier === 'premium'` with `isOwner`/`canClone`/`canGoPrivate`. Keep `ratingModeFor` delegating to `canRate` (or replace call sites). Update the existing container tests to assert unchanged behavior (mutation lens: the D7 clone-gate now agrees across platforms — the mobile test proving `canClone` for a public non-owner and the web test must both pass). Unify the Home widget tier mapping onto `rankTier`. Run web + mobile suites + tsc. Commit:

```bash
git commit -m "refactor(recipes): adopt shared access policy + viewer vo in detail (w9/p4)"
```

---

## Task 4: P5 — `queryOptions` factory module + cache policy + projection registry

**Files:**

- Create: `packages/clients/recipe-service/src/queries.ts` (+ `__tests__/queries.test.ts`)
- Modify: `packages/clients/recipe-service/src/hooks.ts` (hooks consume factories; `invalidateRecipeProjections` delegates to `recipeProjections`)
- Modify: `packages/clients/recipe-service/src/index.ts` (export `recipeQueries`/`collectionQueries`/`ingredientQueries`/`recipeProjections`)

**Interfaces:**

- Produces:
    - `recipeQueries(client: RecipeServiceClient)` → `{ list(params), listInfinite(params), detail(id), versions(id), version(id, n), photos(id), search(params), searchInfinite(params) }`, each returning a v5 `queryOptions({ queryKey, queryFn, staleTime, gcTime })`. Keys come from `recipeServiceKeys` (unchanged). **Per-domain policy:** detail/list `staleTime: 30_000`; search `staleTime: 15_000`; versions `staleTime: 60_000` (rarely change) — values are a reviewable decision, not library defaults by omission. Document each.
    - `collectionQueries(client)` → `{ list(params), detail(id) }`.
    - `ingredientQueries(client)` → `{ search(query, limit), status(id), candidates(id) }` — **preserve the self-limiting `refetchInterval`** on `status`.
    - `recipeProjections(recipeId): readonly QueryKey[]` — the invalidation registry: `[recipe(id), recipeLists, recipeSearches, collections]`. `invalidateRecipeProjections` becomes a thin loop over it. This is the single authority DA2 folds into (the Task-1 test still passes, now via the registry).

- [ ] **Step 1: Write the failing factory test** — the factory produces a usable `queryOptions` with the right key + a stated staleTime, and `recipeProjections` includes all four regions:

```ts
import { describe, expect, it, vi } from 'vitest';
import { recipeQueries, recipeProjections } from '../queries.js';
import { recipeServiceKeys } from '../hooks.js';

const fakeClient = { getRecipe: vi.fn().mockResolvedValue({ id: 'rec_1' }) } as never;

describe('recipeQueries (P5 repository read seam)', () => {
    it('builds detail options with the canonical key and an explicit stale policy', () => {
        const options = recipeQueries(fakeClient).detail('rec_1');
        expect(options.queryKey).toEqual(recipeServiceKeys.recipe('rec_1'));
        expect(options.staleTime).toBeTypeOf('number'); // a DECISION, not the library default
    });
});

describe('recipeProjections (P5 registry, folds DA2)', () => {
    it('names exactly the four regions a recipe write stales', () => {
        expect(recipeProjections('rec_1')).toEqual([
            recipeServiceKeys.recipe('rec_1'),
            recipeServiceKeys.recipeLists,
            recipeServiceKeys.recipeSearches,
            recipeServiceKeys.collections,
        ]);
    });
});
```

- [ ] **Step 2: Run, watch fail** (`queries.ts` absent). → FAIL.
- [ ] **Step 3: Implement `queries.ts`** per Interfaces. Match the client method names actually used in `hooks.ts` (`listRecipes`/`getRecipe`/`getRecipeVersions`/`searchRecipes`/… — read them off the current hooks to avoid a name mismatch). Build `queryOptions` from `@tanstack/react-query`.
- [ ] **Step 4: Refactor `hooks.ts` to consume the factories** — each read hook becomes `useQuery(recipeQueries(useRecipeServiceClient()).detail(id))` (+ `enabled` where present); `useInfiniteSearchRecipes` uses `searchInfinite`. Rewrite `invalidateRecipeProjections` as `for (const key of recipeProjections(recipeId)) void queryClient.invalidateQueries({ queryKey: key })`. **Preserve** the search-outside-`recipes` contract and the ingredient-status `refetchInterval`.
- [ ] **Step 5: Run the WHOLE client + all consumer suites** (web/mobile/features container tests mock these hooks — verify their mocks still match the one-liner hooks' shapes) + tsc + lint. Fix drift. Expect PASS.
- [ ] **Step 6: Commit.**

```bash
git commit -m "feat(recipe-client): queryOptions factories + cache policy + projection registry (w9/p5)"
```

---

## Task 5: DA3 — write-through cache updates from mutation responses

**Files:** Modify `packages/clients/recipe-service/src/hooks.ts` (+ `__tests__`).

**Interfaces:** no signature change. `useUpdateRecipe`/`useCloneRecipe`/`useSetRecipeVisibility`/`useRestoreRecipeVersion` return the full updated `RecipeDetail`; on success, `setQueryData(recipeServiceKeys.recipe(id), updated)` (write-through the single entity the response fully describes) THEN invalidate the fan-out (`recipeLists`/`recipeSearches`/`collections` — the response can't reconstruct those rows). `deleteRecipe` (void) stays invalidate-only. **Constraint:** write-AFTER-success only; never an optimistic pre-write on `updateRecipe` (the CAS 409 flow is the point).

- [ ] **Step 1: Write the failing test** — after a successful update, the detail cache holds the server payload with NO refetch:

```ts
it('writes the update response through to the detail cache (DA3, no refetch round-trip)', async () => {
    // Arrange: a QueryClient with recipe(rec_1) seeded stale; a client whose updateRecipe resolves the new detail.
    // Act: run the mutation.
    // Assert: getQueryData(recipeServiceKeys.recipe('rec_1')) deep-equals the response; the fan-out keys are invalidated.
});
```

Flesh this out against the existing hooks test harness (real `QueryClient`, a fake `RecipeServiceClient`, `renderHook` from `@testing-library/react` with a wrapper providing both).

- [ ] **Step 2: Run, watch fail** (cache still holds the stale value). → FAIL.
- [ ] **Step 3: Implement** the `setQueryData` write-through + fan-out invalidation in the four hooks.
- [ ] **Step 4: Run client + consumer suites + tsc + lint.** Verify the detail containers still behave (they read `useRecipe`, which now hydrates from write-through). Expect PASS.
- [ ] **Step 5: Commit.** `git commit -m "perf(recipe-client): write-through mutation responses to the detail cache (w9/da3)"`

---

## Task 6: DA4 — optimistic rating in the hook; delete the container bridge

**Files:**

- Modify: `packages/clients/recipe-service/src/hooks.ts` (`useSetRecipeRating`/`useDeleteRecipeRating`) (+ `__tests__`)
- Modify: `web/.../RecipeDetailContainer.tsx`, `mobile/.../RecipeDetailScreen.tsx` — delete the `ratingOverride` state, the render-phase reset block, and the `resolveSelectedStars` bridge wiring; feed the rating control directly from `recipe.viewerRating`.
- Possibly remove now-dead `resolveSelectedStars`/`RatingSelectionOverride` from `features/recipes/rating/model.ts` if no consumer remains (grep first; keep if still used).

**Interfaces:** the two rating hooks gain `onMutate` (snapshot `recipe(id)` + optimistically patch `viewerRating` and the derived `averageRating`/`ratingCount` if computable, else just `viewerRating`), `onError` (rollback to snapshot), `onSettled` (invalidate `recipeProjections(id)` to reconcile with server truth). This is the Command-with-optimistic-update pattern in the RIGHT layer.

- [ ] **Step 1: Write the failing hook test** — optimistic set, rollback on error, reconcile on settle:

```ts
it('optimistically sets the viewer rating and rolls back on error (DA4)', async () => {
    // seed recipe(rec_1) with viewerRating: undefined; client.setRecipeRating rejects.
    // act: mutate({ id: 'rec_1', input: { stars: 4 } }).
    // assert during-flight: getQueryData(recipe).viewerRating === 4 (optimistic).
    // assert after error: getQueryData(recipe).viewerRating === undefined (rolled back to snapshot).
});
```

- [ ] **Step 2: Run, watch fail.** → FAIL.
- [ ] **Step 3: Implement** `onMutate`/`onError`/`onSettled` on both rating hooks. Cancel in-flight `recipe(id)` queries in `onMutate` (`queryClient.cancelQueries`) before patching, per the TanStack optimistic recipe.
- [ ] **Step 4: Delete the bridge** from both containers (state, render-phase reset, `resolveSelectedStars` call); the rating control's `selectedStars` now comes straight from `recipe.viewerRating`. Update the container tests: the "rating error does not leak across a client navigation" test still holds (now because the hook rolls back + the id-switch resets the mutation), and the optimistic pre-select is asserted at the hook layer. Run web + mobile + features suites.
- [ ] **Step 5: Extend optimism to visibility toggle + collection add/remove** (genuinely optimistic-worthy per DA4) — same onMutate/onError/onSettled shape, one hook at a time, each with its own red→green. (If time-boxed, ship rating-only and leave a one-line pointer for visibility/membership as a follow-on — but the master lists all three; prefer doing all three.)
- [ ] **Step 6: Full verify + commit.**

```bash
git commit -m "feat(recipes): optimistic rating in the hook, delete container bridge (w9/da4)"
```

---

## Task 7: B1 note (already shipped)

**B1** (mobile profile-edit clobber) is a CP-5 ship-gate item but was **already implemented** earlier on this branch (commit `fd93a53`, `profile.tsx` split into `ProfileScreen` + `ProfileEditForm` seeded via `key={data.user.id}`). Verify it is present (`git log --oneline --grep b1`) and that `mobile/tests/screens/ProfileScreen.native.test.tsx` passes; no new work. Do NOT reimplement.

---

## Self-Review

- **Spec coverage:** DA2 (Task 1 + folded into P5's registry Task 4), T1 (Task 2), P4 (Task 3), DA6 (Task 3), P5 (Task 4), DA3 (Task 5), DA4 (Task 6), B1 (Task 7, pre-shipped). All CP-5 register items mapped.
- **Preserved invariants checklist (assert in review):** search stays outside `recipes`; membership-write narrowness unchanged (only the reverse direction added); `ratingModeFor`/`canRate` fail-safe ordering; fail-closed tier; `usesPremiumCapability` untouched as the server badge; ingredient-status `refetchInterval` preserved through the factory; CAS edit path stays pessimistic (DA3 is post-success, DA4 excludes `updateRecipe`).
- **Type consistency:** `Viewer`/`Tier`/`makeViewer`, `recipeQueries(client).detail(id)`, `recipeProjections(id)`, `isOwner/canClone/canGoPrivate/canRate` names are used identically across tasks. Branded-id constructor names (`recipeId`/`userId`) match their guards (`isRecipeId`).
- **Cross-service guard:** `profileQueries`/B12 deliberately scoped OUT (belongs to identity client, master sequences it in CP-7/DA10) — one-line pointer only, no build here.
- **Open risk to watch during execution:** Task 4 rewires every read hook; the web/mobile/feature container tests mock these hooks by name — run the full consumer suites after Task 4 and reconcile any mock-shape drift before proceeding to Tasks 5–6.
