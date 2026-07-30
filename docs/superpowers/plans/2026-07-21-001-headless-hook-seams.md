# CP-6 — Headless-Hook Seams Implementation Plan (W9 step 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. A detailed current-state map lives at `.superpowers/sdd/cp6-current-state.md` — read the relevant section before each task.

**Goal:** Give `@commise/features-recipes` a headless-hook seam and move the recipe editor / ingredient resolver / photo uploader orchestration out of the per-platform app layers (where it is hand-copied and drifted) into shared, platform-agnostic hooks — closing the B24 photo-upload race by construction — plus two shared test-infra utilities (a fake-client render helper) that the resulting thinner container tests adopt.

**Architecture:** The package today exports only pure models + presentational components (zero hooks). CP-6 adds a `hooks/` seam exported at a new `@commise/features-recipes/hooks` subpath. Each shared hook is a **headless hook** (state + mutations + a pure transition function, no markup); each platform's container/screen becomes a thin leaf that renders the hook's returned view-state with its own DOM/RN markup + file-picker. The edit lifecycle becomes an explicit **discriminated-union statechart** (`useRecipeEditor`) that resolves the current web-vs-mobile reseed incompatibility by making the form's value state fully controlled from the hook (eliminating mobile's remount hack). Photo upload becomes a **single-flight** hook (`useRecipePhotoUpload`) with an in-flight guard + abort-on-unmount. Ingredient resolution becomes `useIngredientResolver` (a view-state union + pure `nextMatchAction`). Test infra gets a shared `renderWithProviders` (T4) and a type-checked `FakeRecipeServiceClient` seam (T3, generalizing the existing `hookHarness.ts`).

**Tech Stack:** TypeScript strict, React 19 + `@tanstack/react-query` v5, React Native 0.79 / react-native-web (native leaves under jsdom), Vitest + React Testing Library, npm workspaces + Turborepo. New package: `@commise/test-utils`. Packages touched: `@commise/features-recipes`, `@commise/web`, `@commise/mobile`, `@kitchensink/recipe-service-client` (a testing export), and the new `@commise/test-utils`.

## Global Constraints

_Every task's requirements implicitly include this section._

- **TDD mandatory** (red→green), per `docs/CODING_STANDARDS.md §7.1`. Non-UI hooks: unit tests (via the existing `hookHarness.ts` fake-client pattern in the recipe-service-client, or the new T3 helper) AND, where a container is UI, its component tests. A hook/feature is not done until every category it touches passes.
- **Cross-platform:** every hook extraction migrates BOTH the web leaf and the mobile leaf in the same task; the shared hook lives in `@commise/features-recipes/hooks` (platform-agnostic — no DOM, no RN imports; if a hook genuinely needs a platform primitive, use a `.native.ts` sibling, but prefer platform-agnostic). Preserve the `.native.tsx` suffix convention for markup leaves.
- **Node 24 REQUIRED:** prefix every command with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH` (shell defaults to Node 18; vitest/husky fail otherwise).
- **Mobile `.native` SCREEN tests** fail locally on `@expo/vector-icons`/`expo-modules-core` ESM (pre-existing, CI-only). Verify mobile via `npx tsc --noEmit` + the runnable non-screen tests; never treat that pre-existing failure as a new regression. `features-recipes` native tests DO run locally.
- **Conventional Commits**, commitlint-enforced: lowercase subject, body ≤ 100 cols. Footer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git commit -F`; explicit `git add <paths>` (the worktree has unrelated untracked scratch — never `git add -A`).
- **TypeScript** strict, zero `any`, no `@ts-ignore`/`@ts-expect-error`. `.js` on cross-package/aliased imports, `.ts`/`.tsx` on relative; `import type`; named exports only. Refs are near-forbidden (permitted only to wrap a genuinely external, non-declarative system — an AbortController/mounted flag in the photo hook qualifies). Presentational leaves stay pure `props → JSX`; the hook owns state + effects.
- **Pattern-first:** each hook's JSDoc names its pattern (headless hook; statechart/discriminated-union reducer; single-flight command). Lead commit/PR bodies with the pattern.
- **Preserved invariants (do NOT regress):**
    - `useIngredientStatus` poll stays SELF-LIMITING (stops on non-PENDING) — driven by the factory's `refetchInterval`, never a manual loop.
    - Photo: `presign → PUT → confirm` order, each a distinct mutation; `confirm → invalidateRecipeProjections` stays the SINGLE existing call site (the hook calls `useConfirmPhotoUpload`; it must NOT reimplement invalidation); the web input reset-in-`finally` (same-file re-pick) is preserved.
    - Edit: seed-once guard (no clobber on background refetch); a resubmit after a 409 carries `theirs.currentVersion` as `expectedVersion`; a handled 409 NEVER surfaces as a generic save error.
    - Ingredient: the freeform "add anyway" fallback is reachable from EVERY terminal path; `enabled` gating on candidate fetches; the four add-paths (catalog-hit / addByName / candidate / freeform) all converge on one `resolveLine`.
    - The recipe-service hook contracts (names/params/return shapes) are unchanged — this plan consumes them, it does not alter `@kitchensink/recipe-service-client`.

---

## File Structure

- **New:** `packages/apps/commise/features/recipes/src/hooks/` — `usePollIngredientStatus.ts`, `useRecipePhotoUpload.ts`, `useIngredientResolver.ts`, `useRecipeEditor.ts`, `index.ts`; each with `__tests__/`.
- **Modify:** `features/recipes/package.json` (add `"./hooks"` export subpath), `features/recipes/src/index.ts` (do NOT fold hooks into the root barrel — hooks get their own subpath so a non-React consumer of the pure models never pulls hooks).
- **New package:** `packages/tools/test-utils` (`@commise/test-utils`) — `src/renderWithProviders.tsx` (T4) + `src/index.ts`; depends on `@commise/i18n`, `@testing-library/react`, React.
- **New testing export:** `@kitchensink/recipe-service-client` gains a `./testing` subpath exporting a `FakeRecipeServiceClient` builder generalized from `src/__tests__/utils/hookHarness.ts` (T3).
- **Modify (thin the leaves):** `web/src/components/recipes/{RecipePhotoUploaderContainer,IngredientPicker,IngredientStatusPoller,RecipeEditContainer,RecipeCreateContainer}.tsx` + `mobile/src/components/{RecipePhotoUploader,IngredientPicker,IngredientStatusPoller}.tsx` + `mobile/src/screens/{RecipeEditScreen,RecipeEditor,RecipeCreateScreen}.tsx` — each drops its copied orchestration and consumes the shared hook.
- **Modify (test infra adoption):** the 12 web container test files (T3) + the 12 LocaleProvider-wrapping test files (T4) — two DISJOINT file sets (per the map), do not conflate.

---

## Task 1: T4 — shared `renderWithProviders` (`@commise/test-utils`)

**Why first:** foundational, zero production risk, and later hook/container tests adopt it. It is independent of the hooks.

**Files:** Create `packages/tools/test-utils/{package.json,tsconfig.json,src/renderWithProviders.tsx,src/index.ts,src/__tests__/renderWithProviders.test.tsx}`. Model the package.json/tsconfig on an existing leaf package (e.g. `packages/apps/commise/features/account`).

**Interfaces:**

- Produces `renderWithProviders(ui: ReactElement, options?: { locale?: string }): RenderResult` — wraps `ui` in `<LocaleProvider locale={locale ?? 'en'}>` (from `@commise/i18n/react`) and returns RTL's `render` result. (The T3 fake-client provider composes in a later overload/option — see Task 6's note; for now LocaleProvider only.)

- [ ] **Step 1: Scaffold the package** (`package.json` name `@commise/test-utils`, `private: true`, `type: module`, `main: ./src/index.ts`, deps: `@commise/i18n`, `@testing-library/react`, React as peer; devDeps mirror a sibling). Add it to the workspace (root already globs `packages/tools/*`). Run `npm install`.
- [ ] **Step 2: Write the failing test** — `renderWithProviders(<ComponentUsingUseMessages/>)` renders localized copy (a component that calls `useMessages` throws without a `LocaleProvider`; the helper must satisfy it). Run red.
- [ ] **Step 3: Implement `renderWithProviders`.** Green.
- [ ] **Step 4: Migrate the 12 LocaleProvider-wrapping test files** (map §6 list: 6 web + 6 mobile) to import `renderWithProviders` instead of hand-declaring a `<LocaleProvider>` wrapper. Run each package's suite after migration; no assertion changes. (Mobile screen tests are CI-only — migrate + tsc.)
- [ ] **Step 5:** format + lint + tsc across touched packages; commit `test(test-utils): shared renderWithProviders, adopt across home tests (w9/t4)`.

---

## Task 2: B4 seam + `usePollIngredientStatus` (the lowest-risk first hook)

**Why now:** establishes the `hooks/` directory + the `@commise/features-recipes/hooks` export subpath (the B4 seam) using the ALREADY-identical `IngredientStatusPoller` logic (map §1: byte-for-byte equivalent across platforms) — the safest possible first extraction, proving the seam before the harder hooks.

**Files:** Create `features/recipes/src/hooks/usePollIngredientStatus.ts` + `__tests__/`, `features/recipes/src/hooks/index.ts`; modify `features/recipes/package.json` (`"./hooks": "./src/hooks/index.ts"`); modify web `IngredientStatusPoller.tsx` + mobile `IngredientStatusPoller.tsx` to consume it.

**Interfaces:**

- Produces `usePollIngredientStatus(ingredientId: string, onStatus: (status: FoodResolutionStatus) => void): void` — wraps `useIngredientStatus(ingredientId)` (from the recipe-service-client) + the single `useEffect` that fires `onStatus` when `status.data?.foodResolutionStatus !== undefined` (and changed). Platform-agnostic (no markup). The two `IngredientStatusPoller` leaves become one-liners returning `null` after calling the hook.

- [ ] **Step 1:** add the `"./hooks"` export subpath + create `hooks/index.ts`. **Step 2:** write the failing hook test (using the recipe-service-client `hookHarness.ts` pattern OR a mocked `useIngredientStatus`): the hook fires `onStatus` once when a terminal status arrives, and not before. Red. **Step 3:** implement `usePollIngredientStatus`. Green. **Step 4:** rewrite both `IngredientStatusPoller` leaves to `usePollIngredientStatus(ingredientId, onStatus); return null;`; keep their existing component tests green (behavior identical). **Step 5:** verify the self-limiting poll invariant is untouched (the hook calls `useIngredientStatus`, which owns the `refetchInterval`). format/lint/tsc; commit `feat(recipes): headless-hook seam + usePollIngredientStatus (w9/b4)`.

---

## Task 3: P3 + B24 — `useRecipePhotoUpload` (single-flight, close the race)

**Files:** Create `features/recipes/src/hooks/useRecipePhotoUpload.ts` + `__tests__/`; modify web `RecipePhotoUploaderContainer.tsx` + mobile `RecipePhotoUploader.tsx` to consume it.

**Interfaces (platform-agnostic core; each platform passes its own file-acquisition):**

- `useRecipePhotoUpload(recipeId: string): { uploading: boolean; errorMessage: string | undefined; upload: (file: { blob: Blob; fileName: string; contentType: string; fileSize: number }) => Promise<void>; }` — owns `uploading`/`errorMessage` state + the `presign → PUT → confirm` sequence via `useCreatePhotoUploadUrl` + raw `fetch` PUT + `useConfirmPhotoUpload`. **Single-flight:** `upload` early-returns if `uploading` is already true (the B24 fix — a second call while in flight is rejected/ignored, not interleaved). **Abort-on-unmount:** an `AbortController` (the one legitimate ref) passed to the PUT `fetch`, aborted in a cleanup effect, and a mounted flag so a late `confirm`/`setState` can't write after unmount. On success/failure it sets state; it does NOT reimplement invalidation (`useConfirmPhotoUpload` already calls `invalidateRecipeProjections`).
- Web leaf keeps its `<input type="file">` + the `inputRef` reset-in-`finally` (call `upload({ blob: file, ... })` then reset the input) + adds the B24 guard: the input/label is `disabled`/gated while `uploading`. Mobile leaf keeps its `expo-image-picker` acquisition + its existing `disabled={uploading}` Pressable.

- [ ] **Step 1: write the failing single-flight test** — with a controllable presign/confirm, call `upload` twice back-to-back while the first is in flight; assert the SECOND call is a no-op (the client's presign mutation is invoked exactly ONCE), and state stays consistent. Also a happy-path test (presign→PUT→confirm all fire in order) and an error test (a failed PUT sets `errorMessage`, clears `uploading`). Red.
- [ ] **Step 2:** implement `useRecipePhotoUpload` with the in-flight guard + AbortController + mounted flag. Green.
- [ ] **Step 3:** rewrite the web container to consume the hook (keep the input-reset-in-finally + add the disabled-while-uploading guard — this closes B24 at the DOM level too) and the mobile component likewise. Keep both platforms' existing component tests green; ADD a web test proving the input is disabled / a second pick is rejected during an in-flight upload (the B24 regression guard). **Step 4:** verify `confirm → invalidateRecipeProjections` still fires exactly once via the existing mutation. format/lint/tsc; commit `feat(recipes): single-flight photo-upload hook, close the double-submit race (w9/p3,b24)`.

---

## Task 4: P2 — `useIngredientResolver`

**Files:** Create `features/recipes/src/hooks/useIngredientResolver.ts` + `__tests__/` (+ a pure `nextMatchAction` in the same file or `hooks/ingredientResolver.model.ts`); modify web `IngredientPicker.tsx` + mobile `IngredientPicker.tsx` to consume it.

**Interfaces:**

- `useIngredientResolver(onResolved: (line: RecipeFormIngredient) => void): { query, setQuery, viewState, selectMatch, pickCandidate, addFreeform, ... }` where `viewState` is a discriminated union `{ kind: 'idle' } | { kind: 'searching' } | { kind: 'results'; results } | { kind: 'disambiguating'; candidates: ... } | { kind: 'resolving' } | { kind: 'terminal'; status }`. It owns `query`/`disambiguating` state + the four add-paths converging on one `resolveLine`. Unify the two platforms' drifts: ONE callback name (`onResolved`), ONE `resolveLine` (decide the mutation-reset question — the map shows web resets, mobile argues the unmount makes it redundant; the hook owns the subtree lifetime, so pick the correct single behavior and document it), and the named `isTerminalStatus`/`isUnresolvedStatus` helpers.
- Pure `nextMatchAction(status: FoodResolutionStatus): 'resolve' | 'disambiguate'` — the catalog-hit/addByName branch decision, unit-tested exhaustively over the status enum.
- Each picker leaf becomes a thin renderer of `viewState` with its own markup.

- [ ] **Step 1:** write the failing `nextMatchAction` unit test (exhaustive over `FoodResolutionStatus`) + the failing hook tests (idle→searching→results; catalog-hit resolves or disambiguates per status; candidate pick resolves; freeform always reachable from a terminal state — the fallback-reachability invariant). Red. **Step 2:** implement the pure fn + the hook. Green. **Step 3:** rewrite both picker leaves to render `viewState`; keep their component tests green (migrate assertions to the unified callback name; no behavior loss — the freeform fallback stays reachable from every terminal branch). **Step 4:** verify `enabled` gating on candidate fetches + the self-limiting poll survive. format/lint/tsc; commit `feat(recipes): headless ingredient-resolver hook (w9/p2)`.

---

## Task 5: P1 — `useRecipeEditor` statechart (the hard one)

**Files:** Create `features/recipes/src/hooks/useRecipeEditor.ts` + `__tests__/`; ensure ONE `toRecipeFormValues` in `form/model.ts` (B2 — collapse the seed adapter); move merge selections into the machine (consume the dangling `defaultMergeSelections` or delete it); modify web `RecipeEditContainer.tsx` + mobile `RecipeEditScreen.tsx`/`RecipeEditor.tsx` to consume it.

**Interfaces:**

- `useRecipeEditor(recipeId: string, opts: { onSaved: (recipe: RecipeDetail) => void }): { state: EditorState; values; errors; setField/setValues; submit(); resolutions: { keepMine(); useTheirs(); merge(selections) } }` where `EditorState` is a discriminated union `{ status: 'loading' } | { status: 'editing' } | { status: 'submitting' } | { status: 'conflict'; theirs; mine; draft } | { status: 'saved' }`, modeled on `deriveAuthState` (`account/src/authState.ts`) for the reducer style. The hook owns: seed-once (guarded, no clobber on background refetch), validate, submit-with-`expectedVersion`, the 409→`conflict` transition (`isVersionConflictError` only — a handled 409 never surfaces as a generic error), and the three resolutions. **Resolve the reseed incompatibility:** the form's value state is FULLY CONTROLLED from the hook, so "use theirs" is a plain `setValues(toRecipeFormValues(theirs))` transition on BOTH platforms — mobile no longer needs its `seedNonce`/`seedOverride` remount hack, and the editor leaf becomes a controlled component (values in from the hook, `onChange` out). Merge selections live in the machine (default 'mine' via `defaultMergeSelections`), NOT in `RecipeConflictView` (which becomes controlled: selections + onChange in/out).
- **Must preserve:** seed-once guard; resubmit carries `theirs.currentVersion`; handled-409 ≠ generic error.

- [ ] **Step 1:** write failing hook tests for the statechart: seeds once (a background refetch does NOT clobber unsaved edits); a submit that 409s transitions to `conflict` (not a generic error); `useTheirs` reseeds values from `theirs`; a resubmit carries `expectedVersion === theirs.currentVersion`; `merge(selections)` composes via `composeMergedRecipe` and submits. Red. **Step 2:** implement `useRecipeEditor` (reducer + orchestration). Green. **Step 3:** make `RecipeConflictView` controlled (lift merge selections into the machine — wire it to `defaultMergeSelections`, deleting the inline `?? 'mine'` duplication OR deleting `defaultMergeSelections` if you inline instead; the map notes it is currently dangling). **Step 4:** rewrite web `RecipeEditContainer` + mobile `RecipeEditScreen`/`RecipeEditor` to consume the hook (mobile's editor becomes controlled — DELETE `seedNonce`/`seedOverride` + the remount key). Keep both platforms' container/screen tests green; the reseed-no-clobber + 409-handled tests must hold. **Step 5:** collapse to ONE `toRecipeFormValues` in `form/model.ts` (remove the duplicated seed adapter, B2). format/lint/tsc; commit `feat(recipes): edit statechart headless hook, unify reseed across platforms (w9/p1,b2)`.

---

## Task 6: T3 — `FakeRecipeServiceClient` seam + migrate the 12 web container tests

**Why last:** the containers are now thin (post P1–P3), so migrating their tests to the type-checked fake-client seam is cleaner and the migration reflects the final container shapes.

**Files:** add a `./testing` export to `@kitchensink/recipe-service-client` exposing a `FakeRecipeServiceClient` builder generalized from `src/__tests__/utils/hookHarness.ts` (a real `RecipeServiceClient` + `rejectingFetch` guard + `vi.spyOn` helpers, or a fake implementing the client interface so stubs are type-checked); add `renderWithRecipeClient` to `@commise/test-utils` (composing LocaleProvider + `RecipeServiceProvider` + a `QueryClientProvider`). Migrate the 12 web container test files (map §5 list) off `vi.mock('@kitchensink/recipe-service-client/hooks')` onto the fake-client + real-hooks approach. Delete the one `as unknown as RecipeServiceClient` partial-fake cast (`home/__tests__/RecipeWidgetSlot.test.tsx:75`).

- [ ] **Step 1:** build + unit-test the `FakeRecipeServiceClient` seam (type-checked against the real client signatures — a renamed method fails `tsc`). **Step 2:** add `renderWithRecipeClient` to `@commise/test-utils`. **Step 3:** migrate the 12 web container tests one at a time, running each after migration (behavior-preserving; the point is type-safety + less per-file boilerplate, not new assertions). Delete the `as unknown as` cast. **Step 4:** full web suite green; format/lint/tsc; commit `test(recipes): fake-client seam over the container tests (w9/t3)`.

---

## Self-Review

- **Coverage:** B4 (Task 2 seam), P3+B24 (Task 3), P2 (Task 4), P1+B2 (Task 5), T3 (Task 6), T4 (Task 1). All CP-6 register items mapped.
- **Ordering rationale:** T4 (infra, independent) → B4 seam via the safest hook → P3/P2 (self-contained hooks) → P1 (hardest, others don't depend on it) → T3 (migrate the now-thin container tests). Tasks touch mostly disjoint files; the hooks are independent concerns. P1 and Task 6 both touch the edit containers — Task 6 runs AFTER P1 so it migrates the final shapes.
- **Preserved-invariants checklist (assert in each review):** self-limiting poll; photo presign→PUT→confirm + single confirm-invalidation + input-reset; edit seed-once + expectedVersion + handled-409≠generic; ingredient freeform-always-reachable + enabled-gating; recipe-service hook contracts unchanged.
- **Risk to watch:** P1 is the highest-risk task (it makes the mobile editor controlled, deleting the remount hack, and lifts merge state into the machine) — its container/screen tests + the W7 conflict tests are the safety net; run them thoroughly. W3 (the edit wizard) will build ON `useRecipeEditor`, so its contract is the load-bearing output of CP-6.
