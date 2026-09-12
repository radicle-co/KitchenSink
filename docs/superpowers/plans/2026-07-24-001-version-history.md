# W6 — Version History: Preview, Compare & Changed-Only Diff Implementation Plan

> ⛔ **SUPERSEDED IN PART (owner ruling, 2026-08-26): device attribution is DELETED.** Every instruction below about `deviceLabel` / `device_label` — the version row's ` (from {device})` suffix, the conflict banner's ` on {device}` clause, the per-side card's `Device:` row and their escaping tests — describes a feature that no longer ships. Nothing ever wrote the field, so none of it had ever rendered. The ruling and what it costs are recorded in [`CR-004`](../../../specs/001-commise-recipe-app/change-requests/CR-004-version-compare-and-conflict-diff.md); `editorHandle` attribution is UNAFFECTED and still ships.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the recipe version-history surface up to its wireframe floor (FR-007b, V1–V6): per-row editor/device attribution + a changed-fields summary, a Preview modal of any past version, a Compare-two-versions flow with a Diff Summary and a changed-only A/B diff, and the web "Back to Recipe" link — on **both** web and mobile.

**Architecture:** Every backend contract W6 needs is already shipped and consumed as-is: `useRecipeVersions(id)` returns each version WITH its full immutable `RecipeSnapshot` (so adjacent-version diffs are computed client-side with no extra fetch); `useRecipeVersion(id, n)` returns one version's full snapshot; W8-a.7's transparent S3 fallback means Preview/Compare of a version older than the last-10 DB window works with **no 404 and no frontend archive UI**. There is deliberately **no server-side diff endpoint** — the diff is a **pure client-side function** over two `RecipeSnapshot`s (master plan §W6). W6 adds: (a) that pure diff function + its changed-fields summary; (b) the presentational Preview modal, Compare selector, and changed-only diff display; (c) row attribution rendering; (d) container/screen wiring; (e) Playwright + Maestro flows.

**Tech Stack:** React 19 (web), Expo/RN 0.79 (`.native.tsx`), TanStack Query v5 (`useRecipeVersions`/`useRecipeVersion`), Radix `Dialog` (web modal) / RN `Modal` (native), Vitest + RTL, Playwright (web e2e), Maestro (mobile e2e). Node 24.

## Global Constraints

_Every task's requirements implicitly include this section. Values from the master plan + the wireframe (`specs/001-commise-recipe-app/product-spec/wireframes/version-history.md`)._

- **Reconciliation floor rule (master Decision 1):** the wireframe is the **floor** — render at least what it shows; retain the shipped restore + conflict behavior (never subtract); flag conflicts as owner rulings rather than unilaterally resolving.
- **Diff is a PURE CLIENT-SIDE function over two `RecipeSnapshot`s.** No server diff endpoint exists or is to be built. The function is pure (`(a, b) => SnapshotDiff`) and MUST be tested under the mutation lens (a test that fails if the diff logic is subtly broken — not just a happy-path smoke test).
- **⛔ Snapshot field scope — the diff covers ONLY the 8 versioned fields.** `RecipeSnapshot` = `{ version, title, description, servings, prepTimeMinutes, cookTimeMinutes, steps[], ingredients[] }` (`recipe.types.ts:660-669`). It does **NOT** version `tags`, `cuisine`, `dietaryFlags`, `visibility`, or `photos`. The changed-fields summary + diff cover only the 8 fields. Do **NOT** invent diff categories (tags/photos/cuisine) that have no snapshot backing — the wireframe's "Changed: … tags" example is illustrative; the real scope is the snapshot. Document this bound in the diff module's JSDoc. (Extending the snapshot is a separate versioning-contract decision, explicitly OUT of W6 scope.)
- **Transparent S3 (owner decision 8):** do **NOT** build any user-facing "View in S3 archive" link the wireframe shows. Preview/Compare of an evicted version works transparently via `useRecipeVersion` (W8-a.7). If a version fetch still errors, show a normal error state, not an archive affordance.
- **Attribution:** the row/preview "by @handle" is `editorHandle`; "(from iPhone)" is `deviceLabel` (W8-a.2/.6). Both are OPTIONAL (omit-null) — render `by @{handle}` only when present, ` (from {device})` only when present, never `@undefined`/`(from undefined)`. `deviceLabel` is bounded free text captured from a client — render it as TEXT (escaped by React), NEVER `dangerouslySetInnerHTML`.
- **Cross-platform (enforced):** every user-facing change ships web AND mobile in the same task; `.native.tsx` leaves; a task is not done until both platforms + both tests exist. Native adaptations: the Compare diff sidebar → a full-screen sheet at mobile widths; the Preview modal → a full-screen takeover.
- **Localization:** every user-facing string via `useMessages`/the messages path; new copy in `versions/messages.ts`. No hard-coded literals.
- **TDD (non-negotiable, §7.1):** failing test BEFORE code, per tier. Pure fns → unit tests (mutation lens). UI → a vitest component test for EVERY state (loading, empty, populated, error, gated, disabled), plus Playwright (web) AND Maestro (mobile) for each happy path. No new service endpoint is added, so no new backend e2e/k6 is required — note this in the final review rather than skipping silently.
- **Standards:** frontend camelCase/PascalCase; named exports only; `.js` on aliased AND relative imports (match siblings); `import type`; UTC/ISO-8601 dates; strict TS, zero `any`, no `@ts-ignore`. `getByRole`/`getByLabel` only in Playwright — no `data-testid`, no `waitForTimeout`.
- **Node 24:** prefix commands with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`.

## Inheritance manifest (contracts consumed, already shipped — do NOT rebuild)

- **`RecipeVersion` wire shape** (`recipe.types.ts:688-712`): `{ id, recipeId, versionNumber, snapshot: RecipeSnapshot, baseVersion?, s3Key?, createdBy, changeSummary?, editorHandle?, deviceLabel?, createdAt }`. `recipeVersionSchema` validates it.
- **`RecipeSnapshot`** (`recipe.types.ts:660-669`): `{ version, title, description, steps: string[], ingredients: RecipeIngredient[], servings, prepTimeMinutes, cookTimeMinutes }`. (Confirm the exact `steps`/`ingredients` element types by reading it — `ingredients` are structured lines.)
- **Hooks** (`@kitchensink/recipe-service-client`): `useRecipeVersions(id)` → `RecipeVersion[]` (each WITH snapshot, newest-first from the server); `useRecipeVersion(id, versionNumber)` → one `RecipeVersion` (full snapshot, S3-transparent); `useRestoreRecipeVersion()` → `{ id, versionNumber }` mutation (already wired, invalidates versions/lists/search/collections, 409→conflict).
- **Existing UI** (`packages/apps/commise/features/recipes/src/versions/`): `RecipeVersionList(.native)` (list + restore only), `model.ts` (`sortVersionsDescending`, `formatVersionTimestamp` — UTC), `messages.ts` (`recipeVersionMessages.versionList`), `RecipeConflictView(.native)` (edit-time merge — NOT reused here). Containers: web `RecipeVersionsContainer.tsx`, mobile `RecipeVersionsScreen.tsx` (has `onBack`; web page has NO Back link — V6).

---

### Task 1: `diffSnapshots` pure function + changed-fields summary (V4 core)

The client-side snapshot diff every other W6 surface consumes. Foundation.

**Files:**

- Create: `packages/apps/commise/features/recipes/src/versions/diff.ts` (or extend `versions/model.ts` — prefer a focused `diff.ts` module).
- Test: `packages/apps/commise/features/recipes/src/versions/__tests__/diff.test.ts`.
- Read first: `packages/shared/recipe-core/src/recipe.types.ts:660-669` (`RecipeSnapshot` + the `RecipeIngredient` element shape) to get exact field/element types.

**Interfaces (produce):**

```ts
export type SnapshotFieldKey = 'title' | 'description' | 'servings' | 'prepTimeMinutes' | 'cookTimeMinutes' | 'steps' | 'ingredients';
export interface SnapshotDiff {
    readonly changedFields: readonly SnapshotFieldKey[];   // which of the 8 fields differ (stable order)
    readonly steps: { readonly added: number; readonly removed: number; readonly modified: number };
    readonly ingredients: { readonly added: number; readonly removed: number; readonly modified: number };
    readonly summary: { readonly added: number; readonly removed: number; readonly modified: number }; // Diff-Summary totals
}
export const diffSnapshots = (base: RecipeSnapshot, target: RecipeSnapshot): SnapshotDiff => { ... };
```

- Scalar fields (`title`/`description`/`servings`/`prepTimeMinutes`/`cookTimeMinutes`): changed if `!==`.
- `steps` (string[]): position-wise — extra positions in target = added, missing = removed, same index different text = modified.
- `ingredients` (structured lines): compare by a stable identity you define (read the `RecipeIngredient` shape — likely an `id` or the name+amount tuple); added/removed/modified counts. Document the identity choice.
- `summary` totals roll up scalar-field changes + steps + ingredients into Added/Removed/Modified counts as the wireframe's "Diff Summary" shows (define the rollup precisely in JSDoc — e.g. a changed scalar counts as 1 modified).
- Pure; JSDoc states the 8-field scope bound + that tags/cuisine/photos are not versioned.

- [ ] **Step 1: Write failing unit tests (mutation lens)** — identical snapshots → empty diff (no changed fields, all zero). A changed title → `changedFields:['title']`, `summary.modified >= 1`. An added step → `steps.added:1` + `steps` in changedFields. A removed ingredient → `ingredients.removed:1`. A modified ingredient (same identity, changed amount) → `ingredients.modified:1`. Multiple simultaneous changes roll up correctly. Assert EXACT counts (a swap of added/removed would fail). Include a case proving a field NOT in the snapshot (e.g. passing objects with a stray `tags`) is IGNORED (not counted).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `diffSnapshots` purely.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): client-side snapshot-diff pure function for version compare`.

---

### Task 2: Version-row attribution + changed-fields summary + web Back link (V1, V3, V6)

**Files:**

- Modify: `versions/RecipeVersionList.tsx` + `.native.tsx` — render per-row editor/device attribution + a changed-fields summary; add per-row `onPreview`/selection affordances (the Preview button lands here, wired in Task 5).
- Modify: `versions/messages.ts` (`byEditor` templated `by @{handle}`, `fromDevice` templated ` (from {device})`, `changedFields` templated `Changed: {fields}`, `initialVersion`, `backToRecipe`).
- Modify: web version route/container to render a "Back to Recipe" link (V6 defect — mobile already has `onBack`); the presentational Back may live in the list header or the container — pick the clean spot (the mobile screen's `onBack` is the parity target).
- Modify: `versions/model.ts` if a helper is needed to compute each row's changed-fields (diff of a version's snapshot vs the immediately-PRIOR versionNumber's snapshot, using Task 1's `diffSnapshots`). v1 (no prior) → the `initialVersion` label, no "Changed:" line.
- Test: `versions/__tests__/RecipeVersionList.test.tsx` + `.native.test.tsx` (extend).

**Interfaces:** `RecipeVersionListProps` gains what the rows need — pass the full `RecipeVersion[]` (already has `editorHandle`/`deviceLabel`/`snapshot`); add `onPreview?: (versionNumber: number) => void` and (for Compare in Task 4/5) a selection mechanism if the list hosts the compare checkboxes — OR keep the list focused and host compare-selection in the container (decide in Task 5; here add attribution + summary + `onPreview`).

- [ ] **Step 1: Failing component tests (web + native)** — a version with `editorHandle:'clara'` + `deviceLabel:'iPhone'` → row shows `by @clara (from iPhone)`; `editorHandle` present, `deviceLabel` absent → `by @clara` no device suffix; both absent → no attribution line (no `@undefined`). A version whose snapshot differs from its prior in title+one step → row shows `Changed: {title, steps}` (localized field names); v1 → `initialVersion` label, no Changed line. Web: a "Back to Recipe" control (`getByRole('link'|'button', {name:/back/i})`). Each row's `Preview` control fires `onPreview(versionNumber)`. Preserve the existing current-badge / restore / busy / error assertions (do NOT weaken them).
- [ ] **Step 2: FAIL → Step 3: Implement** (compute changed-fields via `diffSnapshots` vs the prior version; escape `deviceLabel` as text).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): version-row editor/device attribution, changed-fields summary, web back link`.

---

### Task 3: Preview modal (V2)

**Files:**

- Create: `versions/VersionPreviewModal.tsx` (web Radix `Dialog`) + `.native.tsx` (RN `Modal`, full-screen takeover).
- Modify: `versions/messages.ts` (`previewTitle`, field labels, `changedFromCurrent` templated `Changed from current: {n} ingredients, {m} steps` — or the exact wireframe copy, `keepCurrent`, `restoreThis`, `previewLoading`, `previewError`).
- Test: `versions/__tests__/VersionPreviewModal.test.tsx` + `.native.test.tsx`.

**Interfaces (pure props):**

```ts
interface VersionPreviewModalProps {
    open: boolean;
    version?: RecipeVersion; // the previewed version (full snapshot)
    isLoading: boolean; // useRecipeVersion in flight
    error?: boolean;
    diffFromCurrent?: SnapshotDiff; // Task 1 output vs the current version, for the "Changed from current" line
    onCancel: () => void;
    onRestore: (versionNumber: number) => void; // [Restore this version]
    locale: string;
}
```

Renders the previewed snapshot: title, description, servings, prep/cook/total time, ingredients (with per-line calories if the snapshot ingredient carries them — reuse the existing calorie util if present; else omit), the "Changed from current: N ingredients, M steps" line from `diffFromCurrent`, and `[Keep current version]`(=cancel) / `[Restore this version]`. Web = Radix Dialog (focus-trap/Escape/return — mirror `PullUpdatesDialog.tsx` from W5, which already solved the sibling-trigger focus-restore); native = full-screen `Modal`.

- [ ] **Step 1: Failing component tests (web + native)** — `open:false` → nothing; `isLoading` → progress affordance; populated → title/description/servings/times/ingredients rendered from the snapshot + the "Changed from current" line from `diffFromCurrent`; `error` → error affordance (no dead-end); `[Restore this version]` fires `onRestore(versionNumber)`; `[Keep current]`/Cancel/Escape fires `onCancel`; web focus-trap (`getByRole('dialog')`, Escape → onCancel). `getByRole`/`getByText` on localized copy.
- [ ] **Step 2: FAIL → Step 3: Implement** both leaves (reuse the W5 `PullUpdatesDialog` Radix focus pattern).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): version preview modal with changed-from-current summary`.

---

### Task 4: Compare selector + Diff Summary + changed-only A/B diff (V4, V5)

**Files:**

- Create: `versions/VersionCompareView.tsx` (web — right sidebar/panel) + `.native.tsx` (full-screen sheet).
- Create (maybe): `versions/VersionDiffDisplay.tsx` (+ `.native`) — the changed-only field-by-field A/B render, if it's cleaner as its own presentational unit; else inline in CompareView.
- Modify: `versions/messages.ts` (`compareTitle` templated `Compare v{a} vs v{b}`, `diffSummary`, `added`/`removed`/`modified` labels, `showFullDiff`, `noChanges`, `selectTwoVersions`).
- Test: `versions/__tests__/VersionCompareView.test.tsx` + `.native.test.tsx` (+ diff display tests).

**Interfaces (pure props):**

```ts
interface VersionCompareViewProps {
    open: boolean;
    versionA?: RecipeVersion;
    versionB?: RecipeVersion;
    diff?: SnapshotDiff; // diffSnapshots(A.snapshot, B.snapshot)
    onClose: () => void;
    locale: string;
}
```

Renders the Diff Summary (`Added: N / Removed: N / Modified: N` from `diff.summary`) and a **changed-only** field-by-field A/B display: only fields in `diff.changedFields` are shown, each with the A value and B value side by side (web columns; native stacked). A no-change diff → a "no changes between these versions" message. The two-version SELECTION UI (choosing which two versions) lives in the container/list (Task 5) — this view renders the RESULT given A, B, and the diff. (If the wireframe's selection is a compact in-list checkbox pair, Task 5 wires it; keep this view result-only.)

- [ ] **Step 1: Failing component tests (web + native)** — `open:false` → nothing; given A(v8), B(v12) + a diff with `changedFields:['description','ingredients']`, `summary:{added:1,removed:0,modified:2}` → renders `Compare v12 vs v8` (order per wireframe), the summary counts, and ONLY the description + ingredients rows (title/servings/etc. NOT shown because unchanged) with both sides' values; an empty diff → the no-changes message; `onClose`/Escape fires. Assert unchanged fields are ABSENT (changed-only). `getByRole`/`getByText`.
- [ ] **Step 2: FAIL → Step 3: Implement** both leaves (native = full-screen sheet).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): version compare with diff summary and changed-only A/B display`.

---

### Task 5: Container/screen wiring (web + native)

Compose Tasks 2–4 into the live surfaces + wire the fetches.

**Files:**

- Modify: `packages/apps/commise/web/src/components/recipes/RecipeVersionsContainer.tsx` — Preview: on `onPreview(n)`, fetch via `useRecipeVersion(recipeId, n)` (enabled when a preview target is set), compute `diffFromCurrent = diffSnapshots(previewVersion.snapshot, currentVersionSnapshot)`, render `VersionPreviewModal`; wire `onRestore` to the existing restore mutation. Compare: a two-version selection state (pick A + B from the list), fetch both (they're already in the `useRecipeVersions` list WITH snapshots — so NO extra fetch needed; select from the list data), compute `diffSnapshots(A.snapshot, B.snapshot)`, render `VersionCompareView`. Provide the web "Back to Recipe" link. Preserve the existing list + restore + 409-conflict behavior + tests.
- Modify: `packages/apps/commise/mobile/src/screens/RecipeVersionsScreen.tsx` — the native equivalents (Preview full-screen, Compare sheet); native already has `onBack`.
- Note: because `useRecipeVersions` returns every version WITH its snapshot, Preview and Compare can read the target snapshot(s) directly from the list data — prefer that over an extra `useRecipeVersion` round-trip UNLESS a version is evicted (not in the list). The list is the last-10; if the wireframe allows previewing older-than-10 versions, use `useRecipeVersion` (S3-transparent) for those. Decide + document: the list covers the last-10 (all with snapshots), so Preview/Compare within the list needs no extra fetch; `useRecipeVersion` is the fallback path for an out-of-window version if reachable. Keep it simple: select from list data.
- Test: `web/tests/components/recipes/RecipeVersionsContainer.test.tsx` + `mobile/tests/screens/RecipeVersionsScreen.native.test.tsx`.

- [ ] **Step 1: Failing container/screen tests (web + native)** — clicking a row's Preview opens the modal with that version's content + the changed-from-current line; Restore-from-preview calls the restore mutation with the right versionNumber and (on success) closes; selecting two versions to Compare opens the compare view with the correct diff (summary + changed-only fields); the web Back link navigates to the recipe; the EXISTING list/restore/409-conflict tests still pass unchanged.
- [ ] **Step 2: FAIL → Step 3: Implement** both platforms.
- [ ] **Step 4: PASS** + run the full versions feature + web + mobile suites (no regression); `npm run typecheck` monorepo 35/35.
- [ ] **Step 5: Commit** — `feat(recipes): wire version preview and compare end-to-end`.

---

### Task 6: E2E — Playwright (web) + Maestro (mobile)

**Files:**

- Create: `packages/apps/commise/web/tests/e2e/versions.spec.ts` (no version Playwright flow exists today) — extend the `mockRecipeApi` (`tests/e2e/utils/recipeApi.ts`) to serve `GET /v1/recipes/:id/versions` (a few versions WITH snapshots + editorHandle/deviceLabel + differing content) and `POST /:versionNumber/restore`. Specs: open version history → row shows attribution + changed-fields; Preview a past version (modal shows its content + changed-from-current); Compare two versions (diff summary + changed-only fields); Restore. `getByRole`/`getByLabel` only; no `data-testid`/`waitForTimeout`.
- Create/modify: a Maestro flow `packages/apps/commise/mobile/.maestro/recipes/versions.yaml` — open version history → preview → compare → restore (document any un-drivable step inline, mirroring the `photos.yaml` precedent). Author following the existing Maestro conventions; run locally only if the emulator harness is available, else CI.
- Test: the specs themselves.

- [ ] **Step 1: Extend `recipeApi` mock + write the Playwright `versions.spec.ts`; run it — expect PASS against the real UI** (exercises Tasks 2–5). If the harness can't run locally, report which specs are authored-for-CI (never skip).
- [ ] **Step 2: Write the Maestro `versions.yaml` flow** (run if harness available, else CI).
- [ ] **Step 3: Commit** — `test(recipes): e2e coverage for version preview, compare, and restore`.

---

## Self-review (author checklist — completed)

- **Spec coverage:** V1 row attribution (Task 2), V2 Preview (Tasks 3, 5), V3 changed-fields summary (Tasks 1, 2), V4 Compare/diff (Tasks 1, 4, 5), V5 Diff Summary + changed-only (Task 4), V6 web Back (Task 2). FR-007b Preview+Compare backed by `useRecipeVersion`/list snapshots + the client-side diff. Tests every tier (unit diff; component web+native; Playwright+Maestro). Restore/conflict preserved (Task 5).
- **Type consistency:** `SnapshotDiff`/`SnapshotFieldKey`/`diffSnapshots`, `RecipeVersion`/`RecipeSnapshot`, the modal/compare prop contracts used consistently.
- **No placeholders:** each task names exact files, the diff contract, the exact test cases, an acceptance signal.
- **Decisions resolved in-plan (documented, not deferred):** diff scoped to the 8 snapshot fields (tags/cuisine/photos NOT diffable — snapshot has no backing; flagged to owner, not gated); no S3 archive link (owner decision 8); Preview/Compare read snapshots from the already-fetched list (no extra round-trip within the last-10 window; `useRecipeVersion` is the out-of-window fallback); the diff is a pure client-side fn (no server endpoint).
