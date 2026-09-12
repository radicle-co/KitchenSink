# CP-1 / W3 — Recipe Edit: 4-Step Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`. Detailed current-state map: `.superpowers/sdd/w3-current-state.md` — read the relevant section before each task.

**Goal:** Rebuild recipe edit (and create) from a single-page form into the wireframed **4-step wizard** (Basic / Ingredients / Instructions / Photos) with a Save-Draft/Preview/Cancel/Publish top bar, inline per-row + running per-serving nutrition, per-file photo status with retry, a cuisine dropdown, char counters, and accessible error wiring — web + mobile, on top of the `useRecipeEditor` hook CP-6 delivered.

**Architecture:** A `Wizard`/`Wizard.Step`/`Wizard.Controls` **compound component** (modeled on `RecipeCard.*`) renders step bodies gated by a `step` dimension added to `useRecipeEditor` (orthogonal to `EditorState`, NOT a 6th union arm), with **step-scoped validation** derived by filtering the existing whole-form `validateRecipeForm` result by which fields belong to which step (the whole-form validate stays the gate for actual persistence). The step bodies REUSE `RecipeForm`'s existing fields (do not rewrite them). Nutrition becomes client-reachable by extracting the pure aggregator to `recipe-core`. Per-file photo upload is a NEW **queue layer** above the single-flight `useRecipePhotoUpload` (which is unchanged). Draft/Publish adds an optional `status` to the create/update wire inputs (the server DTO already accepts it) and two submit paths on the hook. Cancel/discard + drift dialogs use the house Radix `AlertDialog` (B6).

**Tech Stack:** TypeScript strict, React 19 + TanStack Query v5, React Native 0.79 / react-native-web, Radix UI (web dialogs), Vitest + RTL, Playwright (web E2E), Maestro (mobile E2E). Packages: `@commise/features-recipes`, `@commise/web`, `@commise/mobile`, `@kitchensink/recipe-core`, `@kitchensink/recipe-service-client`, and `@kitchensink/recipe-service` (nutrition-fn move only, behavior-identical).

## Global Constraints

- **Decision-1 floor rule (verbatim):** the mockup is the **floor** — render at least what `recipe-edit.md` shows; retain any superior shipped affordance it omits; NEVER silently subtract shipped behavior.
- **TDD mandatory across EVERY applicable tier** (owner directive): unit (pure fns/hooks), component (every wizard step + every state), integration, **Playwright (web) AND Maestro (mobile) for every user story**, red→green. A feature is NOT done until each tier it touches passes. The mobile `.native` suite RUNS LOCALLY now (`npx vitest run --config vitest.native.config.ts` from `packages/apps/commise/mobile`) — verify natively, not just CI.
- **Cross-platform:** every user-facing change ships to web (`.tsx`) AND mobile (`.native.tsx`) in the same task; shared logic in shared packages. Native wireframe adaptation: the 4-step indicator collapses to a horizontally scrollable pill row with a "Step N of 4" label; steps render full-screen with the top-bar actions in a sticky header.
- **Node 24:** prefix every command with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`.
- **Preserve these load-bearing accessible names** (Playwright + Maestro depend on them verbatim — they may move to different STEPS but the names must not change): `Title`, `Description`, `Cuisine`, `Servings`, `Prep time (minutes)`, `Cook time (minutes)`, difficulty `Difficulty`/`Hard`/`Not stated`, `Search ingredients`, ingredient result buttons (e.g. `Salt`), `Add step`, `Step 1 instruction`, `Save changes` (edit submit), `Create recipe` (create submit), the detail entry `Edit recipe`. `getByRole`/`getByLabel` only — NO `data-testid`, no `page.waitForTimeout`.
- **Conventional Commits**, commitlint: lowercase subject, body ≤ 100 cols, footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `git commit -F`; explicit `git add` (never `-A`).
- **TypeScript** strict, zero `any`, no `@ts-ignore`. Pure fns pure (`@sideEffect` otherwise); presentational leaves pure; refs near-forbidden (AbortController/mounted flag in the upload layer are the exception). Named exports; `.js` cross-package imports.
- **Consume settled contracts, do NOT re-derive:** `RecipeStatus` (W8-a.3, security-boundary); the nutrition aggregator's rules (W8-a.1 — the SAME fn, moved not reforked). `useRecipeEditor`'s invariants (seed-once no-clobber, `expectedVersion` CAS, handled-409≠generic, `saved`-latch reset) must survive the `step` extension.

## Settled rulings (were open questions — decided here with rationale)

- **OQ-4 (totalTime):** keep the **auto-computed read-only** total on step 1 (`computeTotalTime(prep,cook)`), matching the wireframe floor (`Total time = 45 min (auto)`) and today's client. Do NOT add an editable independent-total field (beyond-wireframe UI). Document the known divergence: the wire schema permits an independent total (inactive time), and a recipe imported/created elsewhere with one will be re-derived to prep+cook if edited through this UI — acceptable for W3; a future editable-total field is out of scope.
- **OQ-2 (Publish with a photo Uploading/FAILED):** Publish is **NOT blocked** by photo state — photos are decoupled from metadata persistence (wireframe: "Metadata saves immediately; photos upload independently; Failed uploads can be retried without re-saving"). Publish sets `status: published` on the recipe immediately; if any photo is mid-upload or failed, show a **non-blocking** notice ("Some photos are still uploading — they'll appear once done, and you can retry any that failed"), do not disable Publish.
- **E5 cuisine list:** add a canonical `CUISINES` readonly const array to `recipe-core` (the codebase's closed-set enum idiom — cf. `RecipeDifficulty`). The dropdown offers `CUISINES`; the wire type stays `cuisine?: string` (NO breaking change), and an existing recipe whose stored cuisine isn't in the list still displays it (render the current value as a selected option even if custom). Provide an "Other…" escape only if trivial; otherwise the curated list + preserved-existing-value is the floor.

---

## Task 1: Extract the nutrition aggregator to `recipe-core` (E3 foundation, behavior-identical)

**Why first:** step 2's per-row + running nutrition (Task 5) needs the pure aggregator reachable from the client bundle; it currently lives in the deployable `recipe-service` and cannot be imported across the workspace boundary.

**Files:** move `packages/services/recipe-service/src/recipes/domain/nutrition.ts` (`computeRecipeNutrition`, `leadCaloriesPerServing`, `NutritionLine`, the `lineMacros` helper) + its `unitToGrams` dependency (`recipe-service/src/common/units.ts`) into `@kitchensink/recipe-core` (`src/nutrition.ts`, `src/units.ts`); re-export from `recipe-core/index.ts`. Update the recipe-service imports to the recipe-core path (NO logic change). Move the accompanying unit tests.

**Interfaces (unchanged, new home):** `computeRecipeNutrition(lines: readonly NutritionLine[], servings: number): RecipeNutrition`; `leadCaloriesPerServing(...): number | undefined`; `unitToGrams(quantity, unit, portions?): number | null`. `RecipeNutrition` already lives in recipe-core.

- [ ] Step 1: move the files + tests into `recipe-core`; re-export. Step 2: update `recipe-service` imports (`recipes.service.ts`/`collections.service.ts`/`recipes.dal.ts`/`search.dal.ts`/`recipeResponse.dto.ts`/`schema/recipes.ts`) to `@kitchensink/recipe-core`. Step 3: run recipe-core + recipe-service suites — the SAME tests must pass in the new home; the service's synth/behavior is byte-identical (verify no diff in what it computes). Step 4: `npm run typecheck` monorepo-wide (the move touches a service). Commit `refactor(recipe-core): host the nutrition aggregator for client reuse (w3/e3)`.

---

## Task 2: Carry ingredient nutrition onto the form line (E3 plumbing)

**Files:** `recipe-core` `RecipeFormIngredient`? — NO, that's in `features/recipes/src/form/model.ts`. Add optional nutrition fields to `RecipeFormIngredient` (`caloriesPer100g?`, `proteinGPer100g?`, `carbsGPer100g?`, `fatGPer100g?`, and the freeform `userCalories?`/macros already on the wire?) — read `Ingredient` (recipe-core) for the exact per-100g field names; carry them through `toIngredientLine` (`hooks/ingredientResolver.model.ts`) so a picked ingredient's nutrition survives onto the form line. Map `RecipeFormIngredient` → `NutritionLine` (a pure `toNutritionLine(line)` in `form/model.ts` or `hooks/`) for Task 5's aggregation.

- [ ] TDD: `toIngredientLine` carries `caloriesPer100g`/macros when present (was dropped); a `toNutritionLine` maps a form line to the aggregator's `NutritionLine` shape (user-override vs per-100g). Component: the existing ingredient-resolver tests stay green. Commit `feat(recipes): carry ingredient nutrition onto the form line (w3/e3)`.

---

## Task 3: Extend `useRecipeEditor` — step state, step-scoped validation, draft/publish

**Files:** `features/recipes/src/hooks/useRecipeEditor.ts` (+ tests); add `status?: RecipeStatus` to `CreateRecipeInput`/`UpdateRecipeInput` in `recipe-core` (the server DTO already accepts it — `recipes.service.ts:538,710`); thread `status` through `toCreateRecipeInput`/`toUpdateRecipeInput` (`form/model.ts`); the client `createRecipe`/`updateRecipe` already serialize the input, so `status` rides through.

**Interfaces (extend, don't break):**

- Add to the hook result: `step: 1|2|3|4`, `goToStep(step)`, `goNext()`, `goPrev()`, `canAdvanceFrom(step): boolean` (step-scoped validity), and `stepErrors(step): RecipeFormErrors` (the subset of `validateRecipeForm(values)` for that step's fields). `step` is orthogonal state — do NOT add it to `EditorState` (keep every `switch(state.status)` consumer unchanged).
- Add `saveDraft(): void` (submits with `status: 'draft'`) and `publish(): void` (submits with `status: 'published'`) alongside the existing `submit()` (which stays the whole-form-validated persistence path — `publish` == validate-all-then-submit-with-published; `saveDraft` == submit-with-draft, relaxed validation per the wireframe "Saves metadata without publishing"). Define the field→step map (step1: title/description/cuisine/tags/dietary/servings/prep/cook/difficulty/visibility; step2: ingredients; step3: steps; step4: photos — photos are decoupled). **Preserve:** seed-once, `expectedVersion`, handled-409≠generic, `saved`-latch reset — add tests proving each still holds WITH the step dimension.

- [ ] TDD (unit): `canAdvanceFrom(1)` false when title blank; `goNext` blocked on invalid current step; `publish` validates all + submits `status:'published'`; `saveDraft` submits `status:'draft'` (relaxed); the four invariants still hold (seed-once no-clobber after a step change; 409→conflict; expectedVersion; saved reset on a post-save edit). Add `status` wire-field tests in recipe-core (schema accepts draft/published/absent). Commit `feat(recipes): step state + step-scoped validation + draft/publish on the editor (w3)`.

---

## Task 4: The `Wizard` compound shell + step rail + top bar (P8) — web + native

**Files:** `features/recipes/src/wizard/` — `Wizard.tsx`/`.native.tsx` (Root + `WizardContext` + `Object.assign` sub-parts `Wizard.Step`, `Wizard.Controls`, `Wizard.Rail`), model + messages; consume the step-extended `useRecipeEditor`. Rewire web `RecipeEditContainer`/`RecipeCreateContainer` + mobile `RecipeEditScreen`/`RecipeCreateScreen` to render the wizard. Reuse `RecipeForm`'s field groups as the step-1/step-3 bodies (extract the field groups if needed; do NOT rewrite fields).

**Scope:** the step rail (`[1] Basic → [2] Ingredients → [3] Instructions → [4] Photos`, "Step N of 4", numbered/filled states); the top bar (`Save Draft`/`Preview`/`Cancel`/`Publish`); footer nav (`< Prev` / `Next >`); the **Cancel/discard guard** (Radix `AlertDialog` per B6 — confirm on Cancel and on step/back nav with unsaved edits); **Publish-blocked-on-invalid-other-step** (flag the offending step in the rail, don't silently 400); **Save-Draft-then-return** (navigates to the list where the draft is visibly present). Preview is a read-only render of the current values (a `RecipeDetailView`-style preview) — scope it minimally (the wireframe just shows the button; a modal/route preview of current form state).

- [ ] TDD (component, both platforms): each step renders its body; Next is gated by step validity + flags the bad step; the rail shows the current + completed steps; Save Draft / Publish call the hook's `saveDraft`/`publish`; Cancel with unsaved edits shows the discard AlertDialog; Publish while another step is invalid flags that step (no submit). Commit `feat(recipes): 4-step edit wizard shell + top bar + discard guard (w3/e1,e2)`.

---

## Task 5: Step 2 — inline ingredient autocomplete + per-row calories + running total (E3 UI)

**Files:** the step-2 body (web + native) folds the `IngredientPicker` search INTO the ingredient row (inline autocomplete), renders **per-row calories** (via the Task-1 aggregator on the row's `NutritionLine`), and a running **"Total nutrition (per serving): N cal | Pg | Cg | Fg"** using `computeRecipeNutrition(values.ingredients.map(toNutritionLine), values.servings)`. Freeform rows show their own calorie figure (user-entered). Handle `isComplete: false` honestly (show the total with a "partial — some ingredients not yet counted" affordance, never a fake 0).

- [ ] TDD: unit — the running total for a known ingredient set matches `computeRecipeNutrition` (mutation-tested — shared with W8-a.1's tests); component — a resolved row shows its calories, a freeform row shows its entered calories, the running total updates on add/remove/quantity-change, and an incomplete set shows the honest partial affordance. Commit `feat(recipes): inline ingredient nutrition + per-serving running total (w3/e3)`.

---

## Task 6: Step 4 — per-file photo grid with status + retry (E4)

**Files:** a NEW queue layer `features/recipes/src/hooks/useRecipePhotoUploadQueue.ts` above the unchanged single-flight `useRecipePhotoUpload` — holds an array of per-file `{ fileId, status: 'queued'|'uploading'|'ok'|'failed', errorMessage? }` (a reducer), driving the existing `upload` once per file **sequentially** (respecting the single-flight guarantee; the grid SHOWS per-file status even though bytes go one-at-a-time), with a `retry(fileId)`. The step-4 body (web + native) renders the wireframed **3-column grid** with per-file status badges (Uploaded ✓ / Uploading spinner / FAILED ✗) + **[Retry]** on failed + [Remove]. Web input gains `multiple`. **Preserve:** `confirm → invalidateRecipeProjections` (via the existing hook — the queue does NOT reimplement it); max 10 photos.

- [ ] TDD: unit — the queue drives `upload` once per file, marks each ok/failed, `retry` re-runs only the failed one, respects the max; component (both platforms) — the grid shows each file's status, a failed file shows Retry and retrying flips it to uploading→ok, Remove drops a file. Commit `feat(recipes): per-file photo upload grid with status + retry (w3/e4)`.

---

## Task 7: Basic-step polish — cuisine dropdown (E5), char counters (E6), B8 aria

**Files:** add `CUISINES` const to `recipe-core`; the step-1 body swaps cuisine free-text → a dropdown from `CUISINES` (preserving an existing custom value); title (64) / description (256) char counters; wire `aria-invalid` + `aria-describedby` on EVERY form input to its error `<p role="alert">` (B8, `AccountEditForm.tsx` is the reference) — web + native.

- [ ] TDD (component, both platforms): the cuisine dropdown lists `CUISINES` and keeps a preselected custom value; the title/description counters update and cap; every invalid field sets `aria-invalid` + `aria-describedby` pointing at its alert (assert the association per field). Commit `feat(recipes): cuisine dropdown, char counters, error a11y wiring (w3/e5,e6,b8)`.

---

## Task 8: E2E rewrite + full-pyramid closure (web Playwright + mobile Maestro)

**Files:** rewrite `web/tests/e2e/recipeCrud.spec.ts` (the edit path) + add a wizard-specific spec (`recipeEditWizard.spec.ts`) driving all 4 steps (create happy path through Basic→Ingredients→Instructions→Photos→Publish; Save-Draft-then-return; Publish-blocked-on-invalid flags the step; per-file photo status; discard guard). Rewrite mobile Maestro `create.yaml`/`edit.yaml` for the 4-step screen-per-step flow (the old single-tall-form choreography is gone). Keep every preserved accessible name (see Global Constraints). Confirm `recipeConflict.spec.ts` + `conflict-merge.yaml` still pass (the wizard composes the SAME `useRecipeEditor` conflict path).

- [ ] Playwright: the 4-step create + edit + draft + publish-blocked + discard flows (`getByRole`/`getByLabel` only). Maestro: the rewritten create/edit flows step-by-step. Run the web suite + confirm the E2E specs are well-formed (they execute in CI). Commit `test(recipes): e2e for the 4-step edit wizard, rewrite create/edit flows (w3/e7)`.

---

## Self-Review

- **Coverage:** E1 (Task 4 shell), E2 (Task 4 top bar/draft/publish + Task 3 hook), E3 (Tasks 1/2/5 nutrition), E4 (Task 6 photo queue), E5+E6+B8 (Task 7), E7 (both platforms every task + Task 8 E2E). OQ-2/OQ-4 ruled above.
- **Preserved invariants:** `useRecipeEditor`'s seed-once/expectedVersion/handled-409/saved-latch survive the step extension (Task 3 tests); `confirm → invalidateRecipeProjections` single call site (Task 6); the nutrition aggregator is MOVED not reforked (Task 1, byte-identical); E2E accessible names verbatim.
- **Risk order:** Task 1 (cross-workspace move touching a deployed service — verify byte-identical) and Task 6 (the queue-vs-single-flight model) are the highest-risk; Task 3 is load-bearing (the wizard + W7 depend on it). Run the FULL mobile native suite (local now) after every UI task.
- **Sequencing:** 1→2 (nutrition data) precede 5; 3 (hook) precedes 4 (shell); 4 precedes 5/6/7 (step bodies); 8 last (E2E over the finished flow).
