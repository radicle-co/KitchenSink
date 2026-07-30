# CP-9 — Quality Remainder (W9/W11 open items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining W9 (frontend architecture/quality) + W11 (test architecture) register items the CP-9 scout verified as still OPEN or PARTIAL against current code — the pre-session work already landed B1/B9/B16/B23/B25a/B26/DA1/DA2/P5/P6 and the P1–P4 seams.

**Architecture:** Next.js 15 web + Expo/RN 0.79 mobile, the `@commise/features-*` packages, TanStack Query v5, the `@kitchensink/recipe-service-client` typed client, `features/core` app-shell tokens. These are quality/DRY/resilience/test-architecture fixes — pattern-first, no product-behavior change except where a resilience fix adds a genuinely-missing state (B18/B22).

**Tech Stack:** React 19, RN 0.79, TanStack Query v5, Radix UI, zod, Vitest + RTL + `userEvent`, Playwright. Node 24.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Master-plan fidelity (W9-g / W9-a–e / W11):** each item's fix is the master's prescription (`docs/superpowers/plans/2026-07-18-001-mockup-parity-reconciliation.md`). Where a prescription overlaps a pattern (W9-f), the pattern is the canonical shape. Master governs on conflict — surface, don't silently diverge.
- **Order = the master's W9-internal priority tail** (plan line 575): DA8/DA9 → B18 → DA5(+B20) → the B21–B25/DA10/B6–B15 remainder; the T-series (T2/T5/T6/T7) slotted opportunistically. This plan's task order follows it.
- **Cross-platform (enforced):** any user-facing/seam change ships web AND mobile in the same task (DA9 boundaries, DA10 facade, B6 dialogs, B14 refs). A task is not done until both platforms have it + tests.
- **Pattern-first (CLAUDE.md §Design-pattern-first):** DA8 = a status value-object/adapter; DA9 = a reporter seam (injected token); DA10 = Facade (AppProviders) + a typed client; B6 = library-first (Radix) over hand-rolled; DA5 = schema-composition (parse-don't-validate); B18 = framework error/loading boundaries. Name the pattern in JSDoc/PR.
- **Library-first (B6, B13):** Radix for dialogs (focus-trap/Escape/return) over hand-rolled `role=dialog`; for B13, the react-navigation deps are DECLARED-BUT-UNUSED — see its task for the owner-flagged resolution.
- **No product-behavior regression on the DRY/refactor items** (DA8/DA10/B12/B14/T2/T5/T6/T7): identical rendered output + green suites are the acceptance bar. Resilience items (B18/B22/DA9) ADD a missing state without changing the happy path.
- **TDD (§7.1):** failing test BEFORE code. UI states → vitest component tests (every state); the resilience items (B18 boundaries, B22 401-retry) get explicit error-path tests. Test-architecture items (T2/T5/T6/T7) are themselves test changes — verify they still assert the same behavior (T5/T7 must NOT weaken assertions).
- **Standards:** frontend camelCase/PascalCase; named exports; `.js` on aliased+relative imports (match siblings); `import type`; strict TS, zero `any`, no `@ts-ignore`; `getByRole`/`getByLabel` in Playwright.
- **Node 24:** prefix commands with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`.

## Inheritance manifest (open-item state — from the CP-9 scout)

- **DA8** OPEN: two byte-identical `toListStatus` (`web/.../recipes/CollectionListContainer.tsx:25`, `RecipeListContainer.tsx:25`); no `QueryStatus`/`toQueryStatus` in `features/core`.
- **DA9** PARTIAL: web wired `captureWidgetError` (`web/.../home/HomeWidgetSurface.tsx:78`); mobile `HomeWidgetSurface.tsx:148,156` still `fallback={null}` NO `onError`; no injected `errorReporter` token (only `loggerToken` `features/core/src/appShell.ts:75`).
- **B18** OPEN: no `error.tsx`/`loading.tsx`/`not-found.tsx` under `web/src/app/` (only `global-error.tsx`); mobile has no root `ErrorBoundary`.
- **B19** OPEN: no `HydrationBoundary`/`prefetchQuery`/`dehydrate` in `web/src/app`; the 4 data pages (`[locale]/{recipes,recipes/[id],discover,collections}/page.tsx`) are client-fetch-only shells. `profile/page.tsx` proves feasibility (server `auth().getToken()`).
- **DA5** OPEN: `features/recipes/src/form/model.ts` `validateRecipeForm` hand-restates rules; no `createRecipeInputSchema` import / `.parse`; `MAX_RECIPE_PHOTOS` only frontend (`photos/model.ts`), not in recipe-core.
- **DA10** OPEN (3): (a) only web has half-facade `RecipeProviders` (`web/.../RecipeProviders.tsx:31`), no mobile `AppProviders`; (b) no `invalidateCollections` helper (only `invalidateRecipeProjections` `hooks.ts:423`; 4 inline collection invalidations); (c) identity client is loose `transport.patch` fns (`features/account/src/profileClient.ts`), not a typed client class + injected TokenSource + typed errors (mirror `RecipeServiceClient`).
- **B6** OPEN: 4 hand-rolled `role=dialog aria-modal` no focus-trap: `features/recipes/src/actions/RecipeDeleteDialog.tsx:36`, `web/.../auth/AccountDeleteForm.tsx:48`, `web/.../home/SubscriptionNudge.tsx:102`, `web/.../home/chrome/HomeMobileNav.tsx`. Radix already a dep of features-recipes (used in PhotoCarousel/PullUpdatesDialog); not in `web/package.json`.
- **B12** OPEN: profile keys/staleTime duplicated (`web/src/hooks/useUserProfile.ts:20` `['user','me']` + staleTime vs `mobile/src/hooks/useUserProfile.ts:8` `['user','me']` + 2min); no shared factory in `features-account`.
- **B22** OPEN: `client.ts` retries only `401` w/ `IDENTITY_SYNC_PENDING` (`:116-117,974-982`); no force-refresh+retry on an ordinary expired-token 401.
- **B7** PARTIAL: `photos/RecipePhotoManager.tsx:56,88` raw `<img>` (no dimensions/loading); the native leaf uses expo-image (B11 done).
- **B14** PARTIAL: `RecipeProviders.tsx:36` `getTokenRef` (render-mutated latest-ref, worst offender), `HomeMobileNav.tsx:57` `closeRef` (blocked on B6), `RecipePhotoUploaderContainer.tsx:51,56` `inputRef`/`previewUrlsRef`.
- **B25b** OPEN: `features/recipes/src/detail/model.ts:18-19` `formatQuantity` bare-interpolates `${quantity}`, no `Intl.NumberFormat` (contrast `card/model.ts`).
- **B13** OPEN: `@react-navigation/native`+`native-stack` declared (`mobile/package.json:32-33`), imported nowhere; hand-rolled nav (`AppRoot.tsx`). Owner-decision (see task).
- **T2** OPEN: no `makeFakeDrizzle`; ~8 test files hand-roll the fake Drizzle chain.
- **T5** OPEN: 23 web/feature test files still use `fireEvent`; `userEvent` in only 16.
- **T6** PARTIAL: generic `bootServiceApp` exists only in identity (`services/identity/tests/e2e/service-harness.ts:61`); recipe-service uses its own `bootRecipeApp`; food-service doesn't consume it; no single DB-isolation contract doc.
- **T7** OPEN: 84 `toBeDefined()` repo-wide; no weak-assertion sweep.

---

### Task 1: DA8 — `QueryStatus` abstraction (dedup `toListStatus`)

**Files:** Create `packages/apps/commise/features/core/src/queryStatus.ts` — `type QueryStatus = 'loading'|'error'|'empty'|'ready'` + `toQueryStatus({ isLoading, isError, isEmpty }): QueryStatus` (a pure discriminator). Modify `web/.../recipes/CollectionListContainer.tsx` + `RecipeListContainer.tsx` to consume it, deleting the two byte-identical `toListStatus`. Test: `features/core/src/__tests__/queryStatus.test.ts` (each branch) + the containers stay green.

- [ ] Failing unit test for `toQueryStatus` (loading/error/empty/ready precedence — loading first, then error, then empty, then ready) → implement → both containers delegate → green. Commit `refactor(features): shared QueryStatus abstraction (dedup toListStatus)`.

### Task 2: DA9 — `errorReporter` seam + mobile widget boundaries

**Files:** Add an `errorReporterToken` (or extend the reporter seam) in `features/core/src/appShell.ts` (mirror `loggerToken`); a `captureWidgetError`-equivalent bound on BOTH platforms. Wire mobile `HomeWidgetSurface.tsx:148,156` boundaries to `onError={report}` (matching web `:78`). Web already has it — route it through the injected token too (not a local fn). Test: a widget that throws → the reporter is called (web + native); the boundary still renders its fallback.

- [ ] Failing test (mobile widget error → reporter called) → implement the token + wire both platforms → green. Commit `feat(features): errorReporter seam wired to home-widget boundaries on both platforms`.

### Task 3: B18 — error / loading / not-found boundaries (web routes + mobile root)

**Files:** Add `error.tsx` + `loading.tsx` (+ `not-found.tsx` where a route can 404) under the web app-router data segments (`web/src/app/[locale]/{recipes,recipes/[id],discover,collections}/` and a segment-level default) — localized, `getByRole` testable, a retry affordance on `error.tsx`. Add a root `ErrorBoundary` to the mobile `AppRoot`. Test: each boundary renders (a thrown child → error boundary + retry; a suspended child → loading). Do NOT swallow errors silently — surface + report (compose with DA9).

- [ ] Failing tests (route error → error.tsx with retry; mobile root boundary catches) → implement → green. Commit `feat(web,mobile): error/loading/not-found boundaries for data routes + mobile root ErrorBoundary`.

### Task 4: B19 — SSR prefetch + `HydrationBoundary` on the data pages

**Files:** Per data page (`[locale]/{recipes,recipes/[id],discover,collections}/page.tsx`): a server `QueryClient`, `prefetchQuery` on the SAME key the container uses (the P5 `recipeQueries`/`collectionQueries` factories — align keys), wrapped in `<HydrationBoundary state={dehydrate(qc)}>`. Follow `profile/page.tsx`'s server `auth().getToken()` pattern. Test: the page prefetches (a server render includes the data / the container hydrates without a client refetch flash) — a Playwright assertion that the list renders without a loading flash, or a unit test that the page dehydrates the right key.

- [ ] Failing test → implement per page (keys aligned to the P5 factories) → green; Playwright confirms no client-fetch flash. Commit `feat(web): SSR prefetch + HydrationBoundary on the recipe/detail/discover/collections pages`.

### Task 5: DA5 — schema-composed form validation (+ B20 codes, `MAX_RECIPE_PHOTOS` to recipe-core)

**Files:** Export `MAX_RECIPE_PHOTOS` (+ any shared limit) from `@kitchensink/recipe-core`; the frontend `photos/model.ts` imports it (single source). Rebuild `features/recipes/src/form/model.ts` `validateRecipeForm` to COMPOSE the recipe-core `createRecipeInputSchema` (`.safeParse`/`.superRefine`) instead of hand-restating rules — emitting the SAME localized error CODES (B20) the UI already renders. Test: the form validation produces identical error codes to today for every invalid case (characterization) + rejects/accepts identically; the shared limit is one constant.

- [ ] Failing test (form validation composes the schema, same codes) → implement → green (no validation-behavior drift). Commit `refactor(recipes): schema-composed form validation + shared MAX_RECIPE_PHOTOS in recipe-core`.

### Task 6: DA10 — composition batch (AppProviders Facade · invalidateCollections · identity client)

**Files:** (a) finish the AppProviders **Facade** on BOTH platforms (web already half-has `RecipeProviders`; add the mobile `AppProviders` composing Clerk+QueryClient+RecipeService in the enforced order); (b) add an `invalidateCollections` helper (symmetry with `invalidateRecipeProjections`) + replace the 4 inline collection invalidations; (c) give the identity/account client the `RecipeServiceClient` SHAPE — a typed client class + injected TokenSource + typed errors (in `features/account`), replacing the loose `profileClient.ts transport.patch` fns; update `useUserProfile` (both platforms) to consume it. Test: the facade renders the provider tree; `invalidateCollections` invalidates the right keys; the typed account client's methods + typed errors are unit-tested.

- [ ] Failing tests per sub-item → implement (a)(b)(c) → green + no regression. Commit `refactor(app): AppProviders facade both platforms, invalidateCollections helper, typed account client`.

### Task 7: B6 — Radix dialogs (replace 4 hand-rolled `role=dialog`)

**Files:** Add `@radix-ui/react-dialog`/`react-alert-dialog` to `web/package.json` (already a features-recipes dep). Convert the 4 hand-rolled dialogs (`RecipeDeleteDialog.tsx`, `AccountDeleteForm.tsx`, `SubscriptionNudge.tsx`, `HomeMobileNav.tsx`) to Radix (focus-trap/Escape/return-focus), mirroring the W5 `PullUpdatesDialog` Radix pattern (incl. the sibling-trigger focus-restore where the opener isn't an owned trigger). Native `HomeMobileNav` = RN Modal if applicable. Test: each dialog — `getByRole('dialog'|'alertdialog')`, Escape closes, focus returns, actions fire. Unblocks B14's `closeRef`.

- [ ] Failing tests → convert each dialog → green (focus-trap + Escape + return verified). Commit `refactor(web): Radix dialogs (focus-trap/escape/return) replace hand-rolled role=dialog`.

### Task 8: B12 — shared profile query-options factory

**Files:** In `features/account`, add a `profileQueries(client)`/`profileQueryOptions` factory owning the `['user','me']` key + staleTime ONCE. `web/src/hooks/useUserProfile.ts` + `mobile/src/hooks/useUserProfile.ts` consume it (delete the duplicated key/staleTime). Test: both hooks use the shared key + staleTime; the factory is unit-tested.

- [ ] Failing test → implement → both hooks delegate → green. Commit `refactor(account): shared profile query-options factory (dedup key+staleTime)`.

### Task 9: B22 — 401 token-expiry force-refresh + retry

**Files:** `packages/clients/recipe-service/src/client.ts` — on an ORDINARY expired-token 401 (not the `IDENTITY_SYNC_PENDING` case, which stays as-is), force a token refresh via the injected `TokenSource` and retry ONCE; if it still 401s, surface `UnauthorizedError`. Careful: bounded single retry (no loop), the `IDENTITY_SYNC_PENDING` path unchanged, and the retry uses a FRESH token. Update the `mobile/.../RecipeServiceGate.tsx:8-9` stale JSDoc. Test: a 401→refresh→retry→200 succeeds; a 401→refresh→401 surfaces UnauthorizedError (no infinite retry); the IDENTITY_SYNC_PENDING path is unaffected.

- [ ] Failing tests (auth path — every branch) → implement bounded refresh+retry → green. Commit `fix(recipe-service-client): force-refresh and retry once on an expired-token 401`.

### Task 10: B7 + B25b — photo-manager image optimization + `formatQuantity` locale parity

**Files:** B7: `features/recipes/src/photos/RecipePhotoManager.tsx:56,88` raw `<img>` → the web-optimized image approach used elsewhere (dimensions + `loading="lazy"`; `next/image` if the app uses it, else explicit width/height + lazy). B25b: `features/recipes/src/detail/model.ts:18-19` `formatQuantity` → `Intl.NumberFormat(locale, …)` (mirror `card/model.ts formatCalories`), locale-aware. Test: the photo grid renders with dimensions/lazy; `formatQuantity` formats locale-correctly (grouping/decimals) + the detail tests stay green.

- [ ] Failing tests → implement both → green. Commit `fix(recipes): optimize photo-manager images (B7) + locale-format quantity (B25b)`.

### Task 11: B14 — ref elimination (getTokenRef, inputRef; closeRef after B6)

**Files:** `web/.../RecipeProviders.tsx:36` `getTokenRef` (the render-mutated latest-ref) → eliminate per the master (a proper `TokenSource` closure/prop, not a render-mutated ref); `RecipePhotoUploaderContainer.tsx:51,56` `inputRef`/`previewUrlsRef` → the file-input ref is a legitimate DOM-wrap (KEEP if it's the only way to trigger the native picker — document the `@sideEffect`/allowed-ref rationale; eliminate `previewUrlsRef` if it's state-in-a-ref); `HomeMobileNav.tsx:57` `closeRef` — now that B6 made it Radix, remove it (Radix owns focus/close). Per CLAUDE.md §3 refs are near-forbidden (only a genuinely-external non-declarative system). Test: the affected components' behavior unchanged; assert no render-mutated ref remains.

- [ ] Failing/characterization tests → eliminate the eliminable refs, document the one legitimate DOM-wrap → green. Commit `refactor(app): eliminate render-mutated/state-in-ref smells (getTokenRef, closeRef, previewUrlsRef)`.

### Task 12: B13 — mobile nav dead-dependency resolution (owner-flagged)

**Decision (resolve in this task, documented):** the app ships a WORKING hand-rolled nav; `@react-navigation/native`+`native-stack` are declared but imported NOWHERE. Rewriting the working nav to react-navigation is a large, risky, no-functional-benefit change; the honest, low-risk fix is to REMOVE the dead deps (carrying an unused nav library IS the smell). **Do the removal** + a code comment documenting that the app deliberately uses a lightweight hand-rolled nav (with the rationale), UNLESS a grep shows the deps ARE used somewhere the scout missed (then keep + wire). Flag for owner: "if react-navigation adoption is desired later, it's a separate feature-sized task."

- [ ] Verify the deps are truly unused (grep) → remove from `mobile/package.json` + document the hand-rolled-nav choice → `npm install` + mobile build/tests green. Commit `chore(mobile): remove unused react-navigation deps; document the hand-rolled nav choice`.

### Task 13: T2 — `makeFakeDrizzle` shared builder

**Files:** Create a shared `makeFakeDrizzle` test builder (in a test-utils location the ~8 consumers can import) that models the fake Drizzle chain once; migrate the ~8 hand-rolled fakes to it WITHOUT weakening their assertions (they still assert the recorded payloads). Test: the builder itself + the migrated tests stay green.

- [ ] Build `makeFakeDrizzle` + migrate the consumers → all green (no assertion loss). Commit `test(recipe-service): shared makeFakeDrizzle builder (dedup ~8 hand-rolled fakes)`.

### Task 14: T5 — `fireEvent` → `userEvent` migration

**Files:** Migrate the 23 web/feature test files still using `fireEvent` to `userEvent` (realistic user interactions). This is MECHANICAL but must NOT change what's asserted — `userEvent` is async (`await user.click(...)`), so update the call sites correctly. Do it in reviewable batches if needed. Test: every migrated file still passes with identical assertions.

- [ ] Migrate (batch as needed) → all green (no assertion change). Commit `test: migrate fireEvent to userEvent across web/feature suites (T5)`.

### Task 15: T6 — shared `bootServiceApp` + DB-isolation contract

**Files:** Promote identity's generic `bootServiceApp` (`services/identity/tests/e2e/service-harness.ts:61`) to a shared location all three services consume; migrate `recipe-service`'s `bootRecipeApp` + wire food-service onto it. Document the single DB-isolation contract (one place) the e2e harnesses follow. Test: the recipe/identity/food e2e suites boot via the shared template + stay green.

- [ ] Promote + migrate recipe/food onto the shared boot + document the isolation contract → e2e green. Commit `test: shared bootServiceApp template + documented DB-isolation contract (T6)`.

### Task 16: T7 — weak-assertion sweep

**Files:** Sweep the 84 `toBeDefined()` occurrences repo-wide — replace each with a MEANINGFUL assertion (the actual expected value/shape) where the intent is a real check; keep `toBeDefined` only where existence genuinely IS the assertion (document why). This STRENGTHENS coverage — a `toBeDefined` that should be `toEqual(expected)` is coverage theater. Do NOT change behavior; only strengthen assertions. Batch by file.

- [ ] Sweep (batched) → each weak assertion strengthened or justified → all green. Commit `test: strengthen weak toBeDefined assertions to meaningful checks (T7)`.

---

## Self-review (author checklist — completed)

- **Coverage:** every OPEN/PARTIAL item from the scout has a task (DA8→1, DA9→2, B18→3, B19→4, DA5→5, DA10→6, B6→7, B12→8, B22→9, B7+B25b→10, B14→11, B13→12, T2→13, T5→14, T6→15, T7→16). DONE items excluded.
- **Order** follows the master's W9-internal tail (DA8/DA9 → B18 → DA5 → the B/DA remainder), T-series slotted after. B6 before B14 (B14's closeRef depends on B6's Radix conversion).
- **Decisions in-plan:** B13 = remove the dead unused deps + document (owner-flag adoption as a separate task); B14 = eliminate render-mutated/state-in-ref, keep only a genuinely-external DOM-wrap with documented rationale; DA5/DA8/DA10/B12/T2/T5/T7 = no behavior change (characterization bar).
- **No placeholders:** exact files, exact fix per item, the test/acceptance signal (characterization for refactors, error-path tests for resilience).
