/**
 * Headless-hook seam (CP-6/P1, B2) — the shared recipe-EDIT lifecycle statechart, extracted from the two
 * platform containers (web `RecipeEditContainer.tsx`, mobile `RecipeEditScreen.tsx` +
 * `RecipeEditor.tsx`) which had grown two INCOMPATIBLE reseed mechanisms: web reseeded an existing
 * controlled-value `useState` in place (`setValues` + `mutation.reset()`); mobile discarded and remounted
 * its editor child via a `seedNonce`/`seedOverride` remount-key hack, because that child seeded its OWN
 * `useState(initialValues)` once on mount and never re-synced from a changed prop. See
 * `.superpowers/sdd/cp6-current-state.md` §2 for the full writeup this hook resolves.
 *
 * **Resolves the reseed incompatibility by making the editor's value state FULLY CONTROLLED from this
 * hook.** Every platform now drives every reseed — the initial seed-once load, AND "use theirs" after a
 * conflict — through the SAME `setValues` transition. There is no remount, no seed override, no ref: the
 * mobile `RecipeEditor` leaf becomes a plain controlled component (`values` in, `onChange` out) instead of
 * owning its own `useState(initialValues)`.
 *
 * Modeled on `@commise/features-account`'s `authState.ts` (`deriveAuthState`) for the discriminated-union
 * STYLE — a `status` discriminant, closed set of branches, deliberate ordering — but unlike that pure
 * derivation function (which re-derives its whole state from external "facts" every call, no history of its
 * own), this hook owns real mutable history: the in-progress draft, and a pending conflict snapshot. So it
 * pairs the union with the `useState`/mutation-orchestration half `deriveAuthState` deliberately leaves to
 * its callers.
 *
 * **Seed-once, guarded by STATE (not a ref).** `seededId` tracks the id of the recipe whose data has already
 * seeded `values`. A background refetch of the SAME recipe (fresh data, same `id`) does not re-run the seed
 * effect, so an in-progress, unsaved edit is never clobbered — only a genuinely different recipe (a changed
 * `id`) reseeds. `state.status` stays `'loading'` until the first seed happens.
 *
 * **409 -> conflict is the ONLY path into `status: 'conflict'`.** Every other mutation failure (network,
 * 5xx, a validation error the server itself rejects) leaves the machine at `'editing'` once the mutation's
 * pending flag clears; `submitError` — computed as `updateRecipe.isError && !isVersionConflictError(...)`,
 * UNCONDITIONALLY, not merely "whenever we are not already showing the conflict view" — is what a container
 * reads to decide whether to show a generic save-error alert. Because that guard is unconditional, a
 * handled 409 can never flash a generic error, not even in the brief async gap between the mutation's
 * `onError` settling and the refetch-driven transition into `conflict` completing (an inline conflict-vs-
 * null check alone would miss exactly that window).
 *
 * **Merge selections live in the machine.** The per-field/per-element mine/theirs choice
 * (`RecipeMergeSelections` — top-level field keys AND, since W7 Task 2, the `steps[N]`/`ingredients:<id>`
 * per-element keys `computeConflictDiff`'s rows carry) is part of the `conflict` state, updated via
 * `resolutions.setMergeSelections`; `RecipeConflictView` is a pure controlled leaf over it, exactly like
 * `values`/`setValues`. `resolutions.merge(selections)` is a free function of its `selections` ARGUMENT — it
 * does not read the machine's own `mergeSelections` back — so it composes (`composeConflictMerge`) and
 * submits deterministically from whatever selections it is given, independent of how those selections were
 * produced. That is also what makes it directly unit-testable with a hand-built selections object, with no
 * UI interaction required.
 *
 * **The 409's `server`/`base` thread in directly — no refetch (W7 Task 2).** `handleUpdateError` reads
 * `VersionConflictError.server`/`.base` (the enriched W8-a.5 body) straight off the error and NEVER calls
 * `query.refetch()`: a follow-up round-trip would only re-introduce the very race the conflict view exists to
 * resolve, and the server already sent everything needed — `draftToSnapshot` projects the draft to the same
 * `RecipeSnapshot` shape, `computeConflictDiff(base?.snapshot, mineSnapshot, server.snapshot)` (W7 Task 1)
 * is precomputed ONCE and carried on `conflict.diff`, and `applyServerSnapshotToRecipeDetail` builds the
 * `theirs` display shell by overlaying `server`'s content onto the cached `query.data` (never a fresh fetch).
 * A diff-empty ("phantom") 409 — mine and theirs already agree on every field — skips `conflict` entirely
 * and resubmits the SAME draft against the fresh `server.versionNumber`, since there is nothing to reconcile.
 * `conflict.versionsBehind` (`server.versionNumber - (base?.versionNumber ?? 0)`) is the X6 staleness signal
 * a Task 3-5 UI warns on; an absent `base` (evicted from version history) degrades it to `server.versionNumber`
 * itself, treated as maximally stale regardless of the raw number.
 *
 * **`keepServer` (Option A) is a DISTINCT terminal outcome from `saved` (W7 Task 2 / OQ-1).** Choosing
 * "keep server" discards the draft and exits `conflict` WITHOUT a write (the server already holds the
 * winning version) — `status` transitions to `'discarded'`, never `'saved'`, so a container can navigate to
 * the recipe's detail view without the "Saved!" messaging a real write earns. `saved`/`discarded` are modeled
 * as one 3-state `terminal` union rather than two booleans specifically so they are mutually exclusive by
 * construction. The pre-W7-Task-2 names `keepMine`/`useTheirs` (kept callable through Task 5 purely so the
 * not-yet-rewired web/mobile containers stayed type-checking) are REMOVED as of Task 6, now that both
 * containers are wired onto `overwrite`/`keepServer` — `overwrite` is `keepMine`'s exact same "yours win"
 * resubmit under its current name; `useTheirs`'s reseed-and-keep-editing behavior has no equivalent in the
 * rebuilt FR-007c UI (Option A now discards + navigates away, it does not reseed and resume editing), so it
 * was deleted outright rather than kept as unreachable dead code.
 *
 * **Wizard step state is orthogonal (w3).** `step`/`goToStep`/`goNext`/`goPrev`/`canAdvanceFrom`/`stepErrors`
 * are pure UI-navigation state layered ON TOP of the statechart above — NOT a 6th `EditorState` variant. A
 * step change never touches `seededId`, `conflict`, or the terminal latch, so every `switch (state.status)`
 * consumer is unaffected and the four core invariants (seed-once, 409→conflict, `expectedVersion`, the
 * terminal latch) hold identically regardless of which step is active. Step-scoped validation
 * (`canAdvanceFrom`/`stepErrors`) filters {@link validateRecipeForm}'s ONE output by the field->step map in
 * `form/model.ts` (`stepErrorsFor`/`canAdvanceFromStep`) rather than forking a second validator.
 *
 * **Draft vs Publish (w3).** `saveDraft`/`publish` both persist through the SAME `submitDraft` path `submit`
 * uses, just with a `status` argument threaded onto the wire input (`toUpdateRecipeInput`'s new optional
 * second parameter). `publish` reuses `submit`'s WHOLE-form `validateRecipeForm` gate (a published recipe
 * must be complete). `saveDraft` uses a deliberately RELAXED floor — `stepErrorsFor(values, 1)` (title,
 * servings, times) — not `validateRecipeForm`'s full requirement of resolved ingredients and steps: a draft's
 * entire point (wireframe: "Saves metadata without publishing") is that ingredients/steps may still be empty.
 * The floor is exactly step 1's fields because those are the ONLY fields `toUpdateRecipeInput` sends
 * unconditionally that the wire schema itself can reject outright (a blank title fails `z.string().min(1)`;
 * `servings`/`prepTimeMinutes`/`cookTimeMinutes` have their own positive/non-negative wire constraints) —
 * ingredients/steps are wire-legal as empty arrays, so nothing stricter is needed to avoid a 400. The plain
 * `submit()` path is UNCHANGED: it calls `submitDraft` with no `status` argument, so `status` is omitted from
 * the wire body and a routine "Save changes" edit never flips an existing recipe's publication state as a
 * side effect.
 *
 * **Save Draft must never downgrade an already-published recipe.** `saveDraft` only sends `status: 'draft'`
 * when the loaded recipe is NOT already published (i.e. it is itself still a draft); when
 * `query.data.status === 'published'`, it sends `status: 'published'` (an explicit no-op re-assertion, not an
 * omit, but behaviorally identical either way — see `toUpdateRecipeInput`'s optional `status` parameter).
 * Before this, `saveDraft` sent `status: 'draft'` UNCONDITIONALLY, so a user editing a live, published recipe
 * — tweaking a field and clicking Save Draft to persist WIP without publishing — would silently pull that
 * recipe out of public listings. This matches the wireframe's own words for Save Draft: "saves metadata
 * without publishing; visibility stays as-is" — "as-is" includes an already-published recipe's publication
 * state, not just its `visibility` field. `publish()` is unaffected — it always sends `status: 'published'`.
 *
 * **`defaultMergeSelections` (`versions/model.ts`) was DELETED, not consumed, by this change.** It built a
 * fully-materialized `{[key]: 'mine'}` record from a LOCALIZED field-label list (itself built from
 * `messages`/`locale`, which this platform-agnostic hook does not have and must not import). The one live
 * reader of a per-field selection's default still treats an ABSENT key as `'mine'` —
 * `composeMergedRecipe` (`selections[key] === 'theirs' ? theirs : mine`) — so seeding `conflict.mergeSelections`
 * with `{}` on conflict entry is BEHAVIORALLY IDENTICAL to seeding it with a materialized default record.
 * (`RecipeConflictView`'s own `sideOf` renders an absent key as NEITHER radio checked — a display/gating
 * distinction from `composeMergedRecipe`'s compose-time default, not a second data-level fallback.) The
 * function had zero production callers before this change (confirmed in the CP-6 current-state map) and
 * gained none after it — keeping an unconsumed third statement of "mine is the default" would have been a
 * DRY liability, not a DRY win, so it (and its dedicated test) were removed rather than force-fed an
 * artificial caller.
 */
import type { Locale } from '@commise/i18n';
import {
    RecipeStatus,
    type RecipeDetail,
    type RecipeSnapshot,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';
// The PATCH envelope, from the contract the service authors — was `recipe-core`'s hand-written
// `UpdateRecipeInput` twin (§15 rule 4 / ADR-0014).
import type { UpdateRecipeRequest } from '@kitchensink/schema-recipe';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useUpdateRecipe } from '@kitchensink/recipe-service-client/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    toRecipeFormValues,
    toUpdateRecipeInput,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '../form/model.js';
import { computeConflictDiff, type ConflictDiff } from '../versions/conflictDiff.js';
import {
    applyServerSnapshotToRecipeDetail,
    composeConflictMerge,
    draftToSnapshot,
    type RecipeMergeSelections,
} from '../versions/model.js';

/**
 * The recipe-edit lifecycle. See the module doc above for the ordering rationale (mirrors `deriveAuthState`'s
 * deliberate-ordering convention): `loading` while the recipe has not yet seeded the draft; `editing` for the
 * normal, idle-form state; `submitting` while a save is in flight; `conflict` after a 409 (carries both
 * sides of the conflict, the draft that lost the race, and the in-progress merge selections); `saved` once a
 * write has succeeded (the caller's `onSaved` fires on the SAME transition — most callers navigate away
 * immediately, so this status is normally transient); `discarded` once the user chose `resolutions.keepServer`
 * (W7 Task 2 / OQ-1 Option A) — the draft is thrown away and NO write happens, so this is a DISTINCT terminal
 * state from `saved`: a container must navigate to the recipe's detail view WITHOUT the "Saved!" messaging
 * `saved` implies (a discard never wrote anything).
 *
 * **`saved`/`discarded` are reset on every transition that resumes editing**, not just set-once: a consumer
 * that does NOT unmount on `onSaved` (a multi-step wizard) can keep the machine alive past a successful save,
 * so BOTH terminal flags are cleared on `setValues`/`setField` (any fresh edit), on a reseed (the seed-once
 * effect), and on entering/resolving `conflict` (every resolution's own resubmit or discard).
 * Without this, a save followed by further editing and a 409 could exit `conflict` back into a stale `saved`
 * display instead of `editing` — see the hook's tests under "saved latch". Modeled as a single 3-state
 * `terminal` union (`'none' | 'saved' | 'discarded'`), not two independent booleans, so the two terminal
 * outcomes are mutually exclusive BY CONSTRUCTION — there is no representable state where both are true.
 */
export type EditorState =
    | { readonly status: 'loading' }
    | { readonly status: 'editing' }
    | { readonly status: 'submitting' }
    | {
          readonly status: 'conflict';
          /** The latest saved recipe that landed while the user was editing, as a displayable shell (its
           *  `currentVersion` is the fresh CAS token) — built from the 409's OWN `server` side, never a
           *  refetch (W7 Task 2). */
          readonly theirs: RecipeDetail;
          /** The draft the user attempted to save (source of a "keep mine"/`overwrite` resubmit). */
          readonly draft: RecipeFormValues;
          /** The in-progress per-field/per-element merge resolution; owned here so `RecipeConflictView` can
           *  be controlled. */
          readonly mergeSelections: RecipeMergeSelections;
          /** The 409's winning server side verbatim (versionNumber/updatedAt/snapshot) — the
           *  enriched W8-a.5 body every resolution's resubmit CAS-tokens against (W7 Task 2). */
          readonly server: VersionConflictSide;
          /** The version the draft was edited from, when still retained in the DB window; ABSENT when
           *  evicted — see `versionsBehind`. */
          readonly base?: VersionConflictSide;
          /** The draft projected to a {@link RecipeSnapshot} — the same shape `diff` 3-way-compares against
           *  `server`/`base`. */
          readonly mineSnapshot: RecipeSnapshot;
          /** The precomputed 3-way diff (`computeConflictDiff(base?.snapshot, mineSnapshot, server.snapshot)`)
           *  the W7 conflict view renders — computed HERE so every consumer sees the identical rows. */
          readonly diff: ConflictDiff;
          /** `server.versionNumber - (base?.versionNumber ?? 0)` (the X6 staleness signal) — an absent `base`
           *  degrades this to `server.versionNumber` itself, which is large for any recipe with real history,
           *  so callers should treat "no base" as maximally stale regardless of the raw number. */
          readonly versionsBehind: number;
          /** Whether a resolve's own resubmit (`overwrite`/`merge`) is currently in flight — mirrors
           *  `updateRecipe.isPending`, computed fresh on every render rather than latched. `status` stays
           *  `'conflict'` throughout (the resolver UI must stay mounted, showing disabled controls, not swap
           *  to a different screen) — this flag is how a container/view disables the option cards and the
           *  merge-submit button for the duration, mirroring how the primary submit's `state.status ===
           *  'submitting'` disables the Wizard's Save/Publish buttons. See the resolutions' own in-flight
           *  guard (`if (updateRecipe.isPending) return;`) this flag is paired with — the guard prevents a
           *  double-submit even if a caller somehow ignores the disabled affordance. */
          readonly isResolving: boolean;
      }
    | { readonly status: 'saved' }
    | { readonly status: 'discarded' };

/** A conflict snapshot mirrors the `conflict` variant of {@link EditorState} minus its `status` discriminant
 *  AND minus `isResolving` — `isResolving` is not data the machine stores, it is derived fresh on every
 *  render from `updateRecipe.isPending` (see the state derivation below), so storing it here would let it go
 *  stale between renders. */
type ConflictInfo = Omit<Extract<EditorState, { status: 'conflict' }>, 'isResolving'>;

/** The two mutually-exclusive terminal outcomes {@link EditorState.status} can settle on after `conflict`
 *  resolves (or a plain submit succeeds), plus `'none'` while neither applies — see the module doc's
 *  "saved`/`discarded` latch" section. */
type TerminalOutcome = 'none' | 'saved' | 'discarded';

/** Options for {@link useRecipeEditor}. */
export interface UseRecipeEditorOptions {
    /** Called with the freshly-persisted recipe immediately after a successful save. */
    readonly onSaved: (recipe: RecipeDetail) => void;
    /** The active BCP-47 locale, threaded into `computeConflictDiff` (W7 Task 1) for locale-correct
     *  ingredient-quantity formatting in the precomputed conflict diff. */
    readonly locale: Locale;
}

/** The load-state surface passed through from the hook's internal `useRecipe` query, for the container's own loading/not-found/error affordance. */
export interface RecipeEditorQueryState {
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly error: unknown;
    readonly refetch: () => Promise<unknown>;
}

/** The state + actions {@link useRecipeEditor} exposes to a container. */
export interface UseRecipeEditorResult {
    /** The edit lifecycle — see {@link EditorState}. */
    readonly state: EditorState;
    /** The controlled draft (blank until the first seed; see `state.status === 'loading'`). */
    readonly values: RecipeFormValues;
    /** Field-level validation errors from the last `submit()` attempt (empty when unattempted or valid). */
    readonly errors: RecipeFormErrors;
    /** Replace the whole draft — what a controlled `RecipeForm`/`RecipeEditor`'s `onChange` wires to. */
    readonly setValues: (values: RecipeFormValues) => void;
    /** Patch a single field of the draft. */
    readonly setField: <K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]) => void;
    /** Validate the draft and, if valid, submit it against the loaded recipe's current version. */
    readonly submit: () => void;
    /**
     * Whole-form validate (same gate as {@link submit}), then submit with `status: 'published'`. A publish
     * requires a COMPLETE recipe — resolved ingredients, non-empty steps — same as any other save.
     */
    readonly publish: () => void;
    /**
     * Submit under a RELAXED floor (step 1's fields only — title, servings, times): ingredients/steps may be
     * empty, matching "Saves metadata without publishing" (the wireframe's own words). Sends `status: 'draft'`
     * UNLESS the recipe is already published, in which case it sends `status: 'published'` — Save Draft must
     * never downgrade a live recipe out of publication. See the module doc for why the floor is exactly step 1
     * and why the published case is preserved.
     */
    readonly saveDraft: () => void;
    /**
     * The UNATTENDED draft save (U34) — what `useRecipeAutoSave` calls, and deliberately NOT {@link saveDraft}.
     *
     * ⛔ `saveDraft` is one command bundling THREE concerns — validate-and-record-errors, persist, and
     * notify-the-container — and a background timer wants only the middle one. Inheriting the other two
     * produced three defects a cook meets within seconds of typing:
     *
     *  1. **It navigated them out of the editor.** `submitDraft`'s `onSuccess` calls `opts.onSaved`, which
     *     both containers wire to "go to the detail page". Type, pause, and the editor closes underneath you.
     *  2. **It painted validation errors nobody asked for.** `validateThenSubmit` records errors BEFORE its
     *     gate, so clearing a title to retype it put "A title is required." under the field on a timer.
     *  3. **It re-armed forever.** That error write stores a fresh object every time, so the render it causes
     *     re-arms the debounce, which fires, which re-renders — a permanent loop on any draft below the floor.
     *
     * So this persists and does nothing else: no `onSaved`, no `setErrors`, and no write at all when the
     * step-1 floor fails (an unattended save has nothing to say about an incomplete draft — the cook is
     * mid-sentence). It DOES set the `saved` terminal, deliberately, because the discard guard's baseline has
     * to move forward or the next tick would write the same content again, forever.
     *
     * Referentially STABLE across renders. `useRecipeAutoSave` holds it in an effect dependency, so a fresh
     * function each render would clear and re-arm the debounce on every render — and a recipe with a
     * `PENDING` ingredient re-renders faster than the debounce window, which would starve the timer in
     * exactly the case it exists for.
     */
    readonly autoSaveDraft: () => void;
    /** Whether the last submit failed for a reason OTHER than a version conflict (a handled 409 is never this). */
    readonly submitError: boolean;
    /**
     * Whether the last submit failed with a 409 that IS a `VersionConflictError` but that this hook could
     * NOT turn into a `conflict` view — no `server` side (a malformed/un-enriched body) and/or no cached
     * recipe to project it onto. `submitError` deliberately stays `false` for every `VersionConflictError`
     * (see its own doc), so without this flag such a 409 would fail with NO visible feedback at all — a
     * silent no-op save. A container should show a generic "this recipe changed elsewhere, reload and try
     * again" message when this is `true`; the draft is preserved and the machine stays `editing` so the user
     * can retry. See the module doc's "the 409's server/base thread in directly" section.
     */
    readonly conflictDataUnavailable: boolean;
    /** The wizard's current step (w3) — orthogonal to {@link state}; a step change never affects the statechart. */
    readonly step: RecipeWizardStep;
    /** Jump directly to `step` (the step-rail's free navigation — no validity gate). */
    readonly goToStep: (step: RecipeWizardStep) => void;
    /** Advance one step, but only when {@link canAdvanceFrom} the current step; a no-op past step 4. */
    readonly goNext: () => void;
    /** Go back one step; a no-op before step 1. */
    readonly goPrev: () => void;
    /** Whether `step` has no validation errors (the `[Next: …]` gate) — see {@link stepErrors}. */
    readonly canAdvanceFrom: (step: RecipeWizardStep) => boolean;
    /** The subset of the draft's validation errors that belong to `step` (filters the ONE validator's output). */
    readonly stepErrors: (step: RecipeWizardStep) => RecipeFormErrors;
    /** The underlying recipe query's load state, for the container's own loading/error/not-found rendering. */
    readonly query: RecipeEditorQueryState;
    /**
     * The "Discard and close" universal escape hatch (wireframe gap #1 — `conflict-resolution.md:34`'s
     * `[< Discard and close]` header exit; a security-review follow-up to the double-submit fix). Abandons
     * the in-progress conflict WITHOUT resolving it — DISTINCT from `resolutions.keepServer` (a specific
     * "keep the server version" CHOICE, one of the three A/B/C resolutions): this is "abandon without
     * resolving, let me review", so it lives OUTSIDE `resolutions` rather than as a fourth entry in it.
     * Transitions to the SAME `status: 'discarded'` terminal `keepServer` produces (see that variant's own
     * doc) — both platform containers already navigate to the recipe's detail view on that transition, so
     * reusing it needs no new container wiring. UNLIKE every `resolutions.*` entry, this is NEVER gated on
     * `updateRecipe.isPending`: a HUNG `overwrite`/`merge` request must never trap the user with no way out.
     * See the module doc's "the universal escape hatch" note and this function's own implementation doc for
     * how a late `onSuccess`/`onError` from the request it interrupted is neutralized. A no-op outside
     * `status: 'conflict'` (nothing to discard).
     */
    readonly discardAndClose: () => void;
    /**
     * The FR-007c conflict resolutions, plus the merge-selection setter the controlled conflict view binds
     * to. `keepServer`/`overwrite` are the ONLY resolutions Options A/B expose (W7 Task 6) — the pre-Task-2
     * names `keepMine`/`useTheirs` have been removed now that both platform containers are wired onto these.
     * Every resolution is a no-op outside `status: 'conflict'`.
     */
    readonly resolutions: {
        /** Option B ("yours win", W7 Task 2): re-submit the draft AS-IS against `conflict.server.versionNumber`,
         *  forcing it to win. */
        readonly overwrite: () => void;
        /** Option A (OQ-1, W7 Task 2): discard the draft and exit `conflict` WITHOUT reseeding `values` and
         *  WITHOUT issuing a write (the server already holds the winning version) — transitions to the
         *  DISTINCT `status: 'discarded'` terminal state so a container can navigate to the recipe's detail
         *  view without showing "Saved!" (that messaging belongs to `status: 'saved'` only). */
        readonly keepServer: () => void;
        /** Option C: compose the merged draft from `selections` (`composeConflictMerge` — top-level field
         *  keys AND the per-element `steps[N]`/`ingredients:<id>` keys `computeConflictDiff`'s rows carry,
         *  W7 Task 1) and submit it against `conflict.server.versionNumber`. */
        readonly merge: (selections: RecipeMergeSelections) => void;
        /** Update the in-progress per-field/per-element merge selections (a no-op outside `status: 'conflict'`). */
        readonly setMergeSelections: (selections: RecipeMergeSelections) => void;
    };
}

/**
 * The shared recipe-edit lifecycle statechart.
 *
 * @param recipeId - The id of the recipe being edited.
 * @param opts - `onSaved` (invoked with the persisted recipe on every successful save) and `locale` (threaded
 *   into `computeConflictDiff` for locale-correct ingredient-quantity formatting).
 * @returns The edit state, the controlled draft, and the submit/resolution actions.
 */
export function useRecipeEditor(recipeId: string, opts: UseRecipeEditorOptions): UseRecipeEditorResult {
    const query = useRecipe(recipeId);
    const updateRecipe = useUpdateRecipe();

    const [values, setValuesState] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [seededId, setSeededId] = useState<string | null>(null);
    const [conflict, setConflict] = useState<ConflictInfo | null>(null);
    const [terminal, setTerminal] = useState<TerminalOutcome>('none');
    // The wizard's step (w3) — deliberately a SEPARATE `useState`, not folded into any of the above: it must
    // never be touched by the seed-once effect, `handleUpdateError`, or the `terminal`-latch resets below, so
    // a step change can never clobber the seed or trip/untrip a terminal outcome (see the module doc).
    const [step, setStep] = useState<RecipeWizardStep>(1);

    // Concurrency epoch (security-review follow-up to the double-submit fix — see `discardAndClose` below,
    // the "Discard and close" universal escape hatch). A REF, not state: it is read/compared exclusively
    // inside `submitDraft`'s own `onSuccess`/`onError` closures, which the underlying mutation invokes at an
    // ARBITRARY future time OUTSIDE React's render cycle — a genuinely external, non-declarative timing the
    // coding standard's "refs near-forbidden" rule carves out an exception for ("permitted only to wrap a
    // genuinely external ... system with no alternative"). Two declarative alternatives were considered and
    // rejected:
    //   1. A `setEpoch(current => ...)` FUNCTIONAL UPDATER that also calls `setConflict`/`setTerminal`/
    //      `opts.onSaved` from inside it — React explicitly documents calling updater functions TWICE in
    //      Strict Mode to catch impurity ("if your updater function is pure ... this should not affect the
    //      behavior" — ours would NOT be pure, so a double-invoke would double-navigate/double-fire `onSaved`).
    //   2. Deferring the apply to a `useEffect` keyed on a captured "outcome" + the current epoch (compared on
    //      a LATER, fresh render) — this adds a render tick between the mutation settling and the state
    //      transition applying, which every existing synchronous `act(() => result.current.submit())` test
    //      for this hook depends on NOT existing (they assert `result.current.state` immediately).
    // A plain ref has neither problem: bumping it is a synchronous, side-effect-free write, and reading it
    // inside a callback is a synchronous comparison, not a second invocation of anything.
    const epochRef = useRef(0);

    // ALLOWED REF (§3), and for the same reason `epochRef` is one: `submitDraft` closes over state that
    // changes every render, so capturing it in `autoSaveDraft`'s `useCallback` deps would destroy the
    // referential stability that keeps `useRecipeAutoSave`'s timer from being re-armed by a poll-driven
    // re-render. It is a stable-handle wrapper over a moving target, never state-in-a-ref (nothing reads it
    // to decide what to render).
    //
    // ⚠️ It buys LESS stability than it looks like, and the gap is recorded rather than claimed closed:
    // `autoSaveDraft` below still deps on `values`, so an EDIT changes its identity, which re-arms
    // `useRecipeAutoSave`'s effect and pushes the deadline out — measured 2026-09-03. That makes the wired
    // cadence a debounce from the LAST edit, not the interval from the FIRST that `AUTO_SAVE_INTERVAL_MS`'s
    // own docblock describes and that the 2026-08-26 ruling chose, so a cook typing continuously is not in
    // fact protected. Closing it means routing `values`/`query.data` through a ref too and giving this
    // callback empty deps — a change to a ruled cadence, so it is surfaced here rather than smuggled in.
    //
    // ⛔ WRITTEN IN AN EFFECT, NEVER IN THE RENDER BODY — React documents that prohibition and this hook
    // pays it in data loss, not a warning. A ref write is not part of the render's work, so React never
    // rolls it back: a render it DISCARDS (a sibling suspends, a transition is interrupted) still advanced
    // the ref to that abandoned pass's closure, and the committed tree then submitted through a
    // `submitDraft` closing over a `recipeId` the user never landed on — an unattended write of THIS
    // recipe's draft, with THIS recipe's `expectedVersion`, onto ANOTHER recipe, past every guard in
    // `autoSaveDraft` (which reads the committed `query.data` and passes). An effect runs only for a render
    // that committed. Pinned by the Suspense case in `useRecipeEditor.test.tsx`, which fails on the
    // render-body assignment.
    const submitDraftRef = useRef<
        (
            draft: RecipeFormValues,
            expectedVersion: number,
            status?: RecipeStatus,
            options?: { readonly silent?: boolean },
        ) => void
    >(() => undefined);

    // Seed the draft from the loaded recipe once; the STATE guard (not a ref, per the coding standards' "refs
    // near-forbidden" rule) keeps a background refetch of the SAME recipe from overwriting in-progress edits —
    // only a genuinely different id (a real navigation to another recipe) reseeds.
    useEffect(() => {
        if (query.data !== undefined && seededId !== query.data.id) {
            setSeededId(query.data.id);
            setValuesState(toRecipeFormValues(query.data));
            // A reseed (a real navigation to a different recipe) always resumes editing, never leaves a stale
            // terminal outcome dangling from whatever the PREVIOUS recipe's edit lifecycle last did.
            setTerminal('none');
        }
    }, [query.data, seededId]);

    // A rejected update for a stale version reads the 409's OWN enriched `server`/`base` sides (W7 Task 2) —
    // it does NOT refetch: the server already sent everything needed to 3-way-diff and display the conflict,
    // and a follow-up round-trip would only re-introduce the race it is trying to resolve. `server` absent
    // (a malformed/un-enriched body — should not happen for the owner-update path this hook drives, per
    // `VersionConflictDetails`'s module docs) or no cached recipe to use as a display shell both degrade to
    // the SAME "cannot build a conflict view" bail the old refetch-miss path used — the draft is preserved
    // and the machine stays `editing`. This is NOT a silent bail: `conflictDataUnavailable` (derived below,
    // the same way `submitError` is) reads straight off `updateRecipe.error`/`query.data`, so a container
    // always has a signal to show the user their save did not apply — closing the silent-no-op-save gap an
    // opus review flagged. `submitError` itself stays `false` (still a handled 409, never the generic error).
    // Any other error leaves the machine at `editing` too (via `updateRecipe`'s own settled isPending/isError).
    const handleUpdateError = (err: unknown, draft: RecipeFormValues): void => {
        if (!isVersionConflictError(err) || err.server === undefined || query.data === undefined) {
            return;
        }

        const { server, base } = err;
        const mineSnapshot = draftToSnapshot(draft, base?.versionNumber ?? server.versionNumber);
        const diff = computeConflictDiff(base?.snapshot, mineSnapshot, server.snapshot, opts.locale);

        if (diff.isEmpty) {
            // Phantom zero-diff fast path (W7 Task 2): mine and theirs already agree on every field, so there
            // is nothing to reconcile — resubmit the SAME draft against the fresh CAS token instead of
            // interrupting the user with a conflict view over content that already matches. If a second
            // phantom 409 races this resubmit, it simply re-resolves against ITS newer version — the content
            // is identical either way, so looping this path can never diverge from correctness.
            setTerminal('none');
            submitDraft(draft, server.versionNumber);

            return;
        }

        const theirs = applyServerSnapshotToRecipeDetail(query.data, server);

        setConflict({
            status: 'conflict',
            theirs,
            draft,
            mergeSelections: {},
            server,
            ...(base === undefined ? {} : { base }),
            mineSnapshot,
            diff,
            versionsBehind: server.versionNumber - (base?.versionNumber ?? 0),
        });
        // Entering conflict always resumes editing (the user must resolve it); never let a stale terminal
        // outcome from an earlier save/discard in this same hook instance resurface once conflict clears.
        setTerminal('none');
    };

    // Persist `draft` with the given optimistic-concurrency token; report success upward, resolve conflicts on
    // 409. `status` (w3) is OPTIONAL and OMITTED by default — `submit()` and the conflict resolutions call
    // this with no status so a routine save/resubmit never touches publication state; `publish`/`saveDraft`
    // are the only callers that pass one.
    const submitDraft = (
        draft: RecipeFormValues,
        expectedVersion: number,
        status?: RecipeStatus,
        // UNATTENDED (U34): suppress `opts.onSaved` only. Everything else — the CAS token, the 409-to-conflict
        // transition, the epoch guard, the `saved` terminal — is identical, because an unattended write must
        // be exactly as safe as a deliberate one. See `autoSaveDraft` for why the notification is the one
        // concern a timer must not inherit.
        options?: { readonly silent?: boolean },
    ): void => {
        const input: UpdateRecipeRequest = { ...toUpdateRecipeInput(draft, status), expectedVersion };
        // Captured NOW (this submission's own epoch) — compared against `epochRef.current` inside the
        // callbacks below, whenever THEY eventually fire. `discardAndClose` bumps the ref if the user leaves
        // before this settles; see the ref's own doc above for why a plain ref (not state) is what makes that
        // comparison correct at callback-fire time rather than at closure-creation time.
        const submissionEpoch = epochRef.current;

        updateRecipe.mutate(
            { id: recipeId, input },
            {
                onSuccess: (recipe) => {
                    // Neutralized: a `discardAndClose` already closed this conflict and bumped the epoch
                    // while this resolve was in flight — a late success must not resurrect a "Saved!" the
                    // user already left behind.
                    if (epochRef.current !== submissionEpoch) {
                        return;
                    }

                    setConflict(null);
                    setTerminal('saved');

                    if (options?.silent !== true) {
                        opts.onSaved(recipe);
                    }
                },
                onError: (err) => {
                    // Same neutralization for a late failure — it must not reopen `conflict` (or anything
                    // else) after the user has already discarded and left.
                    if (epochRef.current !== submissionEpoch) {
                        return;
                    }

                    handleUpdateError(err, draft);
                },
            },
        );
    };

    // The controlled draft's public mutators. Both reset the terminal latch — resuming an edit after a
    // successful save/discard (a wizard that stays mounted past `onSaved`) must fall back to `editing`, not
    // keep reporting a stale `saved`/`discarded` from before this edit. `useCallback` (empty deps:
    // `setTerminal`/`setValuesState` are the stable dispatchers `useState` returns) keeps these referentially
    // stable across renders, same as the raw `useState` setter `setValues` wrapped before this fix.
    const setValues = useCallback((next: RecipeFormValues): void => {
        setTerminal('none');
        setValuesState(next);
    }, []);

    const setField = useCallback(<K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]): void => {
        setTerminal('none');
        setValuesState((current) => ({ ...current, [field]: value }));
    }, []);

    // Shared by `submit`/`publish`/`saveDraft`: run `nextErrors` (each caller's own gate), record them for the
    // container to render, and only proceed to persistence when the gate passed AND the recipe has loaded.
    const validateThenSubmit = (nextErrors: RecipeFormErrors, status?: RecipeStatus): void => {
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0 || query.data === undefined) {
            return;
        }

        submitDraft(values, query.data.currentVersion, status);
    };

    const submit = (): void => validateThenSubmit(validateRecipeForm(values));

    // Whole-form validate (same gate as `submit`) — a published recipe must be complete.
    const publish = (): void => validateThenSubmit(validateRecipeForm(values), RecipeStatus.PUBLISHED);

    // The relaxed draft floor: only step 1's fields (title/servings/times) — see the module doc for why this
    // is exactly step 1, not the whole form. The status argument NEVER downgrades an already-published
    // recipe: only a not-yet-published (still-draft) recipe gets `status: 'draft'` sent; a published one keeps
    // `status: 'published'` explicitly (see the module doc's "Save Draft must never downgrade" section).
    const saveDraft = (): void => {
        const draftStatus = query.data?.status === RecipeStatus.PUBLISHED ? RecipeStatus.PUBLISHED : RecipeStatus.DRAFT;

        validateThenSubmit(stepErrorsFor(values, 1), draftStatus);
    };

    // See the field's own doc for the three concerns this deliberately does not inherit from `saveDraft`,
    // and for why it is `useCallback`-stable. `useCallback` deps are exactly what it reads.
    const autoSaveDraft = useCallback((): void => {
        if (query.data === undefined) {
            return;
        }

        // The SAME relaxed floor `saveDraft` uses — but a failure is a silent no-op here, not a recorded
        // error: the cook is mid-sentence, and a timer has no standing to interrupt them.
        if (Object.keys(stepErrorsFor(values, 1)).length > 0) {
            return;
        }

        const draftStatus = query.data.status === RecipeStatus.PUBLISHED ? RecipeStatus.PUBLISHED : RecipeStatus.DRAFT;

        submitDraftRef.current(values, query.data.currentVersion, draftStatus, { silent: true });
    }, [values, query.data]);

    const goToStep = (next: RecipeWizardStep): void => setStep(next);

    const goNext = (): void => {
        if (step < 4 && canAdvanceFromStep(values, step)) {
            setStep((step + 1) as RecipeWizardStep);
        }
    };

    const goPrev = (): void => {
        if (step > 1) {
            setStep((step - 1) as RecipeWizardStep);
        }
    };

    const canAdvanceFrom = (checkStep: RecipeWizardStep): boolean => canAdvanceFromStep(values, checkStep);

    const stepErrors = (checkStep: RecipeWizardStep): RecipeFormErrors => stepErrorsFor(values, checkStep);

    // Option B ("yours win"): forcing the draft to overwrite the server's winning version.
    //
    // In-flight guard (double-submit fix): `updateRecipe.isPending` is checked ALONGSIDE `conflict === null`
    // for every resolution below, not just this one. Without it, a rapid double-click fired TWO PATCH
    // requests carrying the SAME `expectedVersion` — the loser re-entered a second conflict screen right
    // after the user thought they had resolved the first. `state.conflict.isResolving` (derived below from
    // this SAME `updateRecipe.isPending`) is the paired signal a container/view uses to disable its controls
    // for the duration; this guard is the backstop that holds even if a caller ignores that affordance.
    const resubmitDraftAsIs = (): void => {
        if (conflict === null || updateRecipe.isPending) {
            return;
        }

        // Resuming into a resubmit is a fresh editing attempt, not a continuation of a prior terminal outcome.
        setTerminal('none');
        submitDraft(conflict.draft, conflict.server.versionNumber);
    };

    // The "Discard and close" universal escape hatch (wireframe gap #1; security-review follow-up). UNLIKE
    // `resolutions.keepServer` (which declines outright while a resolve is in flight — see that resolution's
    // own comment), this stays available REGARDLESS of `updateRecipe.isPending`: a HUNG `overwrite`/`merge`
    // request must never trap the user with no escape. Bumping `epochRef` FIRST neutralizes that in-flight
    // resolve's own eventual `onSuccess`/`onError` (see the ref's own doc above) — whichever fires later reads
    // a STALE `submissionEpoch` and no-ops, so it can never flip `terminal` to `'saved'` or reopen `conflict`
    // after the user has already left. Reuses the SAME `'discarded'` terminal `resolutions.keepServer`
    // produces — both are "no write, navigate to the recipe's detail view without a Saved! message" outcomes,
    // and both platform containers already have a `status === 'discarded'` effect wired to that navigation;
    // a distinct terminal would only duplicate that wiring for no behavioral difference. A no-op outside
    // `status: 'conflict'` (nothing to discard), mirroring every `resolutions.*` entry's own guard.
    const discardAndClose = (): void => {
        if (conflict === null) {
            return;
        }

        epochRef.current += 1;
        setConflict(null);
        setTerminal('discarded');
    };

    // No dependency array: every commit republishes the current implementation, and only a commit does.
    useEffect(() => {
        submitDraftRef.current = submitDraft;
    });

    const resolutions: UseRecipeEditorResult['resolutions'] = {
        overwrite: resubmitDraftAsIs,
        keepServer: (): void => {
            // `keepServer` issues no write of its own, but it MUST still decline while another resolution's
            // mutation is in flight: without this guard, discarding here races the outstanding overwrite/
            // merge's own eventual `onSuccess`/`onError` — that callback still fires afterward and can flip
            // `terminal` to `'saved'` (or reopen `conflict` on a second 409) out from under a user who was
            // already navigated away on the `'discarded'` transition below.
            if (conflict === null || updateRecipe.isPending) {
                return;
            }

            // No write — the server already holds the winning version. The DISTINCT `'discarded'` terminal
            // (never `'saved'`) is what lets a container navigate to the recipe's detail view without showing
            // "Saved!" for a discard — see the module doc and `EditorState`'s `discarded` variant.
            setConflict(null);
            setTerminal('discarded');
        },
        merge: (selections: RecipeMergeSelections): void => {
            if (conflict === null || updateRecipe.isPending) {
                return;
            }

            const merged = composeConflictMerge(conflict.draft, toRecipeFormValues(conflict.theirs), selections);
            setTerminal('none');
            submitDraft(merged, conflict.server.versionNumber);
        },
        setMergeSelections: (selections: RecipeMergeSelections): void => {
            setConflict((current) => (current === null ? current : { ...current, mergeSelections: selections }));
        },
    };

    const state: EditorState =
        seededId === null
            ? { status: 'loading' }
            : conflict !== null
              ? { ...conflict, isResolving: updateRecipe.isPending }
              : terminal === 'saved'
                ? { status: 'saved' }
                : terminal === 'discarded'
                  ? { status: 'discarded' }
                  : updateRecipe.isPending
                    ? { status: 'submitting' }
                    : { status: 'editing' };

    return {
        state,
        values,
        errors,
        setValues,
        setField,
        submit,
        publish,
        saveDraft,
        autoSaveDraft,
        submitError: updateRecipe.isError && !isVersionConflictError(updateRecipe.error),
        // Derived the SAME way `submitError` is (straight off `updateRecipe`'s own settled error state, not a
        // separately-tracked flag that could desync from it) — a handled-but-undisplayable 409: it IS a
        // `VersionConflictError` (so `submitError` above stays `false`), but has no `server` side to diff/show,
        // or no cached recipe to project it onto (`query.data`). See the field's own JSDoc.
        conflictDataUnavailable:
            updateRecipe.isError &&
            isVersionConflictError(updateRecipe.error) &&
            (updateRecipe.error.server === undefined || query.data === undefined),
        step,
        goToStep,
        goNext,
        goPrev,
        canAdvanceFrom,
        stepErrors,
        query: { isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch },
        discardAndClose,
        resolutions,
    };
}
