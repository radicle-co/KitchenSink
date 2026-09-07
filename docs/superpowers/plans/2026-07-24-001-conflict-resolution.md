# W7 — Edit-Time Conflict Resolution: Changed-Only Diff + A/B/C Cards Implementation Plan

> ⛔ **SUPERSEDED IN PART (owner ruling, 2026-08-26): device attribution is DELETED.** Every instruction below about `deviceLabel` / `device_label` — the version row's ` (from {device})` suffix, the conflict banner's ` on {device}` clause, the per-side card's `Device:` row and their escaping tests — describes a feature that no longer ships. Nothing ever wrote the field, so none of it had ever rendered. The ruling and what it costs are recorded in [`CR-004`](../../../specs/001-commise-recipe-app/change-requests/CR-004-version-compare-and-conflict-diff.md); `editorHandle` attribution is UNAFFECTED and still ships.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the edit-time version-conflict resolver to its wireframe floor (FR-007c, X1–X7): a per-side banner (version/device/timestamp), a **changed-only** 3-way diff with `[=]`/`[→]`/`[!!]` markers + legend, three **A/B/C option cards** (Keep server / Overwrite with yours / Merge manually), a **per-element** field-by-field merge with selection-gating + a running summary + a >10-versions-behind warning, correct Server-left/Yours-right column order, and a phantom zero-diff fast-path — on **both** web and mobile.

**Architecture:** The backend conflict contract is already shipped: a 409 `VersionConflictError` carries `server` + `base` `VersionConflictSide`s (snapshot + versionNumber + deviceLabel + updatedAt), **already parsed onto the client error object** (`client.ts` `toVersionConflict`). The current frontend DISCARDS it — `useRecipeEditor.handleUpdateError` refetches the server and the `conflict` state carries only `theirs`+`mine`, no `base`. W7's foundation is to **stop refetching and thread `err.server`/`err.base` into an extended `conflict` state**, then compute a **net-new 3-way changed-only diff** (mine vs base vs theirs) client-side (reusing W6's `diffSnapshots` per-element step/ingredient identity where clean, but producing per-field values + classification, which `diffSnapshots` does not). The presentational `RecipeConflictView(.native)` and the `versions/model.ts` conflict helpers are substantially reworked; the statechart (`useRecipeEditor`) already owns the `conflict` sub-state (P1) and is extended, not rebuilt.

**Tech Stack:** React 19 (web), Expo/RN 0.79 (`.native.tsx`), the `useRecipeEditor` statechart + `updateRecipe` CAS mutation, `VersionConflictError` (`@kitchensink/recipe-service-client`), Vitest + RTL, Playwright (web e2e), Maestro (mobile e2e). Node 24.

## Global Constraints

_Every task's requirements implicitly include this section. Values from the master plan (§W7, X1–X7) + the wireframe (`specs/001-commise-recipe-app/product-spec/wireframes/conflict-resolution.md`)._

- **Reconciliation floor rule (master Decision 1):** the wireframe is the **floor** — render at least what it shows; retain the shipped CAS-retry + full-payload resolve behavior (never subtract); flag conflicts as owner rulings rather than unilaterally resolving.
- **Use the 409's OWN enriched data — do NOT refetch.** The `VersionConflictError` already carries `server` (current) + `base` (the version the caller edited from) snapshots + per-side metadata (versionNumber/deviceLabel/updatedAt). Thread these into the `conflict` state; do NOT `query.refetch()` to reconstruct `theirs` (the current refetch DISCARDS `base` and the per-side metadata, making a 3-way changed-only diff + the banner impossible).
- **Changed-only (X1):** the diff renders ONLY fields that actually differ (mine vs base, or theirs vs base). Each rendered field is marked `[=]` unchanged (shown only when the wireframe illustrates context), `[→]` changed on one side, `[!!]` conflict (both sides changed the same field differently), with a legend. Unchanged-everywhere fields are NOT rendered.
- **A/B/C option cards (X2):** three cards — **[A] Keep server** (discard local), **[B] Overwrite with your version** (yours win), **[C] Merge manually** (field-by-field) — each with a description + attribution line.
- **Per-element merge (X4):** merge granularity is a single step or ingredient (and each scalar field), NOT a whole-array "8 ingredients" count. The merge picks per changed element.
- **Selection-gating (X5):** the Resolve / Save-merged action is DISABLED until the user has made a selection; a merge with no selections shows an inline hint, never a silent "mine" default that saves.
- **>10-versions-behind warning (X6):** if the caller's base is more than 10 versions behind server current (`server.versionNumber - base.versionNumber > 10`, or base is absent because it was evicted), show an explicit warning requiring confirmation before overwrite/merge.
- **Column order (X7):** **left/first = Server (theirs), right/second = Yours (mine)** — the current code has them reversed (mine first). Fix everywhere (banner, diff columns, merge radios).
- **Phantom zero-diff fast-path:** if the 409 fires but the 3-way diff is EMPTY (mine === theirs, e.g. a concurrent identical save), do NOT show the conflict UI — auto-resolve (resubmit with the fresh version, or treat as saved) and proceed.
- **OQ-1 ruling (resolved in this plan):** on a SUCCESSFUL resolve, ALL three options navigate to the recipe DETAIL, matching a normal save's `onSaved` destination. **Keep server (Option A)** discards the local draft and navigates to detail with NO save request (server already holds that version). Overwrite/Merge save a new version (CAS with the fresh `server.versionNumber`) then navigate to detail.
- **editorHandle NOT required for the banner floor:** the wireframe banner shows device + timestamp + version per side (no `@handle`). `VersionConflictSide` lacks `editorHandle` — do NOT extend the backend contract for it; the banner floor is met by the existing fields. (Flag as a possible future enhancement, do not build.)
- **Cross-platform (enforced):** web AND mobile in the same task; `.native.tsx` leaves; a task is not done until both platforms + both tests exist.
- **Localization:** every user-facing string via `useMessages`; conflict copy in `versions/messages.ts`. No hard-coded literals. `deviceLabel` is untrusted free text → escaped TEXT only, never `dangerouslySetInnerHTML`.
- **TDD (non-negotiable, §7.1):** failing test BEFORE code, per tier. Pure fns → unit tests (mutation lens). UI → a vitest component test for EVERY state (no-selection/gated, changed-only, conflict-marked, >10-warning, each option card, merge mode, error), plus Playwright (web) AND Maestro (mobile) for the happy path. No new service endpoint is added — no new backend e2e/k6 required; note this in the final review.
- **Standards:** frontend camelCase/PascalCase; named exports; `.js` on aliased AND relative imports (match siblings); `import type`; ISO-8601 dates; strict TS, zero `any`, no `@ts-ignore`. `getByRole`/`getByLabel` only in Playwright — no `data-testid`, no `waitForTimeout`.
- **Node 24:** prefix commands with `export PATH="$HOME/.nvm/versions/node/v24"*/bin:$PATH`.

## Inheritance manifest (contracts consumed, already shipped — do NOT rebuild)

- **`VersionConflictError`** (`clients/recipe-service/src/errors.ts`): `{ currentVersion, conflictingVersion, server?: VersionConflictSide, base?: VersionConflictSide }` + `isVersionConflictError` guard. Parsed onto the error in `client.ts` `toVersionConflict`.
- **`VersionConflictSide`** (`recipe-core/recipe.types.ts:737-746`): `{ versionNumber, deviceLabel?, updatedAt: IsoDateTimeString, snapshot: RecipeSnapshot }`. (NO `editorHandle` — see constraint.)
- **`RecipeSnapshot`** (`recipe.types.ts:660-669`): the 7 content fields + version. `RecipeFormValues` (`form/model.ts`) — the editable form shape. `RecipeDetail` — the full detail projection.
- **`diffSnapshots(base, target): SnapshotDiff`** (`versions/diff.ts`) — W6's 2-way per-element (steps position-wise, ingredients `ingredientId`-keyed) diff. A reusable INGREDIENT for the per-element classification, NOT a 3-way drop-in.
- **`useRecipeEditor`** (`hooks/useRecipeEditor.ts`): `EditorState` union incl. the `conflict` variant; `resolutions.{keepMine,useTheirs,merge,setMergeSelections}`; `submitDraft(draft, expectedVersion)` CAS. Resolve sends the FULL recipe (`toUpdateRecipeInput`) — W8-a.5 full-payload contract (preserve).
- **Existing helpers** (`versions/model.ts`): `toConflictSideFields` (7-field, all — REPLACE with changed-only), `buildRecipeMergeFields` (top-level keys, all — REWORK to per-element changed-only), `composeMergedRecipe` (pure; reuse/extend for per-element), `RecipeMergeSelections` (`Record<string,'mine'|'theirs'>` — extend key space to per-element).
- **Backend `raiseVersionConflict`** (`recipes.service.ts:887-916`) — builds the enriched 409; already correct + wired. Do NOT change it.

---

### Task 1: 3-way changed-only conflict diff pure function + phantom-zero detection (X1 core)

**Files:**

- Create: `packages/apps/commise/features/recipes/src/versions/conflictDiff.ts`.
- Test: `packages/apps/commise/features/recipes/src/versions/__tests__/conflictDiff.test.ts`.
- Read first: `versions/diff.ts` (reuse the step/ingredient identity helpers), `RecipeSnapshot`, `RecipeFormValues`.

**Interfaces (produce):**

```ts
export type ConflictMarker = 'unchanged' | 'changed' | 'conflict';   // [=] / [→] / [!!]
export interface ConflictFieldRow {
    readonly key: string;                 // field key (scalar) or a per-element key (e.g. `steps[2]`, `ingredients:<ingredientId>`)
    readonly label: string;               // NOT localized here — carry the key; the view localizes (or pass a labeler)
    readonly marker: ConflictMarker;
    readonly base?: string;               // formatted base value (absent if base evicted)
    readonly mine: string;                // formatted mine value
    readonly theirs: string;              // formatted theirs value
    readonly mineChanged: boolean;        // mine !== base
    readonly theirsChanged: boolean;      // theirs !== base
}
export interface ConflictDiff {
    readonly rows: readonly ConflictFieldRow[];   // CHANGED-ONLY (marker !== 'unchanged'), stable order
    readonly hasConflict: boolean;                // any row marker === 'conflict'
    readonly isEmpty: boolean;                    // no changed rows at all (phantom zero-diff)
}
export const computeConflictDiff = (base: RecipeSnapshot | undefined, mine: RecipeSnapshot, theirs: RecipeSnapshot): ConflictDiff => { ... };
```

- Classification per field/element: `mineChanged = mine !== base`; `theirsChanged = theirs !== base`; marker = `conflict` if BOTH changed AND `mine !== theirs`; `changed` if exactly one side changed (or both changed to the same value ⇒ effectively `changed`, not conflict); `unchanged` if neither changed. Changed-only ⇒ rows exclude `unchanged`.
- When `base` is `undefined` (evicted), fall back to a 2-way mine-vs-theirs classification (can't tell WHO changed, so any `mine !== theirs` field is a `conflict`; document this degradation).
- Scalars: title/description/servings/prep/cook. Per-element: steps (position-wise, reuse `diff.ts` logic) + ingredients (`ingredientId`-keyed). Each changed element is its own row.
- `isEmpty` drives the phantom fast-path (Task 2). Pure; JSDoc the base-evicted degradation + the 7-field scope (matching W6's snapshot bound).

- [ ] **Step 1: Write failing unit tests (mutation lens)** — mine==base==theirs → `isEmpty:true`, no rows. Only mine changed title → one `changed` row (`mineChanged:true, theirsChanged:false`), not conflict. Only theirs changed servings → one `changed` row (theirs side). Both changed title differently → one `conflict` row (`[!!]`, `hasConflict:true`). Both changed title to the SAME value → `changed` (not conflict). A changed step (per-element) → one row keyed to that step index. A changed ingredient → one row keyed by ingredientId. base `undefined` → 2-way fallback (any mine≠theirs = conflict). Assert EXACT rows + markers (a marker swap must fail). Assert changed-only (unchanged fields absent).
- [ ] **Step 2: Run — expect FAIL. Step 3: Implement. Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): 3-way changed-only conflict diff with markers and phantom-zero detection`.

---

### Task 2: Extend `useRecipeEditor` conflict state — thread the 409's server/base, phantom fast-path, keep-server, >10 detection (X3/X5/X6 backing)

**Files:**

- Modify: `packages/apps/commise/features/recipes/src/hooks/useRecipeEditor.ts` — extend the `conflict` variant + `handleUpdateError` + resolutions.
- Test: `hooks/__tests__/useRecipeEditor.test.tsx` (extend).

**Interfaces:**

- Extend the `conflict` `EditorState` variant to carry: `server: VersionConflictSide` (with snapshot + versionNumber + deviceLabel + updatedAt), `base?: VersionConflictSide`, `mineSnapshot: RecipeSnapshot` (the draft projected to a snapshot for the diff), the existing `draft`/`mergeSelections`, and `versionsBehind: number` (`server.versionNumber - (base?.versionNumber ?? 0)` — the X6 signal; treat absent base as ">10"/warn). Keep `theirs: RecipeDetail` for display where needed.
- `handleUpdateError`: read `err.server`/`err.base` from the `VersionConflictError` (do NOT refetch). Build `mineSnapshot` from the draft. Compute `computeConflictDiff(base?.snapshot, mineSnapshot, server.snapshot)`; if `diff.isEmpty` → **phantom fast-path**: resubmit `submitDraft(draft, server.versionNumber)` (or transition to `saved` if nothing to write) WITHOUT entering the conflict UI. Else enter `conflict` with the enriched data.
- Resolutions: `keepServer` (NEW, = Option A): clear conflict, discard draft, signal navigate-to-detail (no request) — replaces the old `useTheirs` reseed semantics per OQ-1. `overwrite` (= Option B, "yours win"): `submitDraft(conflict.draft, server.versionNumber)`. `merge` (= Option C): `submitDraft(composeMergedRecipe(...per-element selections...), server.versionNumber)`. `setMergeSelections` as before. On resolve success → the same `onSaved` → detail path.
- Preserve: the CAS/second-409 re-enter behavior (a second conflict re-reads the new 409's server/base, not a refetch), the full-payload resolve.

- [ ] **Step 1: Write failing unit tests** — a 409 with `err.server`/`err.base` → `conflict` state carries server+base+versionsBehind, and does NOT call `query.refetch()` (assert refetch not called). A 409 whose diff is empty (mine==theirs) → phantom fast-path: resubmits with `server.versionNumber`, no conflict state. `versionsBehind > 10` (or absent base) → the state flags the warning. `keepServer` → discards draft + signals navigate, no mutate. `overwrite` → submitDraft with server.versionNumber. `merge` with per-element selections → composes + submits. A second 409 during resolve re-enters conflict from the NEW error's server/base.
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): thread enriched 409 (server/base) into the editor conflict state with phantom fast-path`.

---

### Task 3: Conflict shell — per-side banner (X3) + A/B/C option cards (X2) + column order (X7)

**Files:**

- Modify: `versions/RecipeConflictView.tsx` + `.native.tsx` — rebuild the DEFAULT (options) view: the banner + three option cards, Server-left/Yours-right.
- Modify: `versions/model.ts` — banner/side-metadata helpers (format "Saved {X} ago on {Device}", version labels); the A/B/C card descriptors.
- Modify: `versions/messages.ts` (banner copy, the three card titles+descriptions, legend, per-side labels).
- Test: `versions/__tests__/RecipeConflictView.test.tsx` + `.native.test.tsx` (rewrite the options-view portion).

**Interfaces:** rework `RecipeConflictViewProps` to carry the enriched conflict data (server/base metadata + the `ConflictDiff` from Task 1 + selections + resolution callbacks `onKeepServer`/`onOverwrite`/`onMerge`/`onSelectionsChange`). Server column/side ALWAYS first.

- [ ] **Step 1: Failing component tests (web + native)** — banner shows `Server version (v{n}): Saved {time} ago on {Device}` (theirs side, using `deviceLabel`/`updatedAt`/`versionNumber`) and `Your version: local unsaved changes`; three option cards render with titles + descriptions ([A] Keep server, [B] Overwrite with your version, [C] Merge manually); clicking [A] fires `onKeepServer`, [B] fires `onOverwrite`, [C] enters merge mode; column/side order is Server-first, Yours-second (assert DOM/tree order); `deviceLabel` escaped (an `<img onerror>` deviceLabel renders no element).
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): conflict banner and A/B/C option cards with server-first ordering`.

---

### Task 4: Changed-only diff display + markers/legend (X1)

**Files:**

- Modify: `versions/RecipeConflictView.tsx` + `.native.tsx` — render the `ConflictDiff.rows` as the changed-only two-column diff with per-row markers + a legend.
- Modify: `versions/messages.ts` (marker legend copy `[=] unchanged / [→] changed / [!!] conflict`, accessible marker labels).
- Test: the same test files (extend).

- [ ] **Step 1: Failing component tests (web + native)** — given a `ConflictDiff` with one `changed` row (title, mine side) + one `conflict` row (servings) → renders EXACTLY those two rows (assert an unchanged field like description is ABSENT), each with its marker (accessible text/role, NOT colour alone) + both sides' values (Server value first, Yours second), and a legend explaining the three markers. An empty diff never reaches this view (Task 2 fast-paths it) — but assert a defensive "no differences" message if `rows` is empty.
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): changed-only conflict diff with marker legend`.

---

### Task 5: Merge mode (Option C) — per-element A/B (X4) + selection-gating (X5) + summary + >10 warning (X6)

**Files:**

- Modify: `versions/RecipeConflictView.tsx` + `.native.tsx` — the merge (Option C) mode.
- Modify: `versions/model.ts` — a per-element merge-field builder (from `ConflictDiff.rows` — merge picks per CHANGED element) + `composeMergedRecipe` extended to apply per-element selections; the "summary of choices" formatter.
- Modify: `versions/messages.ts` (merge copy, `Resolve`/`Save merged version`, the summary line, the >10-versions warning + confirm copy, the no-selection inline hint).
- Test: the same test files (extend) + `model.test.ts` for the per-element merge/compose.

- [ ] **Step 1: Failing component + model tests (web + native)** — merge mode lists ONLY the changed fields/elements (from `ConflictDiff.rows`), each a radiogroup with **Server** and **Your version** radios (Server first); selecting builds `selections`; a running "Summary of choices: N from server, M yours" line updates; **the Save/Resolve button is DISABLED until at least one selection is made** (X5 — assert disabled with zero selections, enabled after one, and that clicking while disabled does NOT fire `onMerge`); the per-element `composeMergedRecipe` applies each selection to the right element (a mutation-lens model test: picking theirs for `steps[2]` swaps only that step); when `versionsBehind > 10` (or base absent) a WARNING renders and Overwrite/Save-merged require an explicit confirm (assert the confirm gate).
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(recipes): per-element conflict merge with selection-gating, choice summary, and stale-base warning`.

---

### Task 6: Container/screen rewiring + OQ-1 navigation

**Files:**

- Modify: `packages/apps/commise/web/src/components/recipes/RecipeEditContainer.tsx` + `packages/apps/commise/mobile/src/screens/RecipeEditScreen.tsx` — render the rebuilt `RecipeConflictView` from the extended `conflict` state; wire `onKeepServer`/`onOverwrite`/`onMerge`/`onSelectionsChange` to the Task 2 resolutions; **OQ-1: on resolve success AND on keep-server, navigate to the recipe detail** (keep-server = discard + navigate with no save; overwrite/merge = the `onSaved` path already navigates — confirm it lands on detail).
- Test: `web/tests/components/recipes/RecipeEditContainer.test.tsx` + `mobile/tests/screens/RecipeEditScreen.native.test.tsx` (rewrite the conflict-integration portion).

- [ ] **Step 1: Failing container/screen tests (web + native)** — a 409 enters the conflict view with the banner + changed-only diff + A/B/C cards (from the 409's server/base, NOT a refetch — assert refetch not called); [A] Keep server discards the draft and navigates to detail (no mutate); [B] Overwrite resubmits with `server.versionNumber` and navigates to detail on success; [C] Merge → per-element selections → resubmit → detail; a phantom zero-diff 409 auto-resolves without showing the conflict UI. Preserve any still-relevant existing conflict-integration assertions (adapt, don't drop).
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS** + full feature/web/mobile suites green; `npm run typecheck` monorepo 35/35.
- [ ] **Step 5: Commit** — `feat(recipes): wire the rebuilt conflict resolver with resolve-to-detail navigation`.

---

### Task 7: E2E — Playwright (web) + Maestro (mobile)

**Files:**

- Rewrite: `packages/apps/commise/web/tests/e2e/recipeConflict.spec.ts` — extend the `mockRecipeApi` so a stale-version update returns the enriched 409 (`server`+`base` snapshots with differing content + deviceLabel/versionNumber/updatedAt). Specs: trigger a 409 → assert the banner (server device/time/version) + the changed-only diff (markers, only changed fields) + the three A/B/C cards; exercise [B] Overwrite → persisted + lands on detail; exercise [C] Merge → per-element pick → persisted + detail; assert Resolve is gated until a selection.
- Update: `packages/apps/commise/mobile/.maestro/recipes/conflict-merge.yaml` — the new banner + A/B/C + per-element merge flow (document any un-drivable step inline).
- Test: the specs themselves.

- [ ] **Step 1: Extend the mock + rewrite the Playwright spec; run it — expect PASS against the real UI** (exercises Tasks 2–6). If the harness can't run locally, report which specs are authored-for-CI (never skip).
- [ ] **Step 2: Update the Maestro flow** (run if harness available, else CI).
- [ ] **Step 3: Commit** — `test(recipes): e2e coverage for the rebuilt conflict resolver`.

---

## Self-review (author checklist — completed)

- **Spec coverage:** X1 changed-only+markers (Tasks 1, 4), X2 A/B/C cards (Task 3), X3 banner (Task 3, backed by the 409's per-side metadata), X4 per-element merge (Tasks 1, 5), X5 selection-gating (Task 5), X6 >10-warning (Tasks 2, 5), X7 column order (Task 3). Phantom zero-diff (Tasks 1, 2). OQ-1 navigation (Task 6). Tests every tier.
- **Type consistency:** `ConflictDiff`/`ConflictFieldRow`/`ConflictMarker`, `computeConflictDiff`, the extended `conflict` `EditorState` variant, `VersionConflictSide`/`VersionConflictError`, the per-element `RecipeMergeSelections` key space used consistently.
- **No placeholders:** each task names exact files, the diff/state contract, the exact test cases, an acceptance signal.
- **Decisions resolved in-plan (documented, not deferred):** OQ-1 = resolve→detail (keep-server discards+navigates, no save); use the 409's own server/base (no refetch); banner floor = device/time/version (no editorHandle backend change); base-evicted → 2-way conflict fallback; phantom zero-diff auto-resolves; column order Server-first.
