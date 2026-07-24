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
 * **Merge selections live in the machine.** The per-field mine/theirs choice (`RecipeMergeSelections`) is
 * part of the `conflict` state, updated via `resolutions.setMergeSelections`; `RecipeConflictView` is a pure
 * controlled leaf over it, exactly like `values`/`setValues`. `resolutions.merge(selections)` is a free
 * function of its `selections` ARGUMENT — it does not read the machine's own `mergeSelections` back — so it
 * composes and submits deterministically from whatever selections it is given, independent of how those
 * selections were produced. That is also what makes it directly unit-testable with a hand-built selections
 * object, with no UI interaction required.
 *
 * **`defaultMergeSelections` (`versions/model.ts`) was DELETED, not consumed, by this change.** It built a
 * fully-materialized `{[key]: 'mine'}` record from a LOCALIZED `RecipeMergeField[]` (itself built from
 * `messages`/`locale`, which this platform-agnostic hook does not have and must not import). Both live
 * readers of a per-field selection already treat an ABSENT key as `'mine'` —
 * `composeMergedRecipe` (`selections[key] === 'theirs' ? theirs : mine`) and `RecipeConflictView`'s `sideOf`
 * (`selections[key] ?? 'mine'`) — so seeding `conflict.mergeSelections` with `{}` on conflict entry is
 * BEHAVIORALLY IDENTICAL to seeding it with a materialized default record. The function had zero production
 * callers before this change (confirmed in the CP-6 current-state map) and gained none after it — keeping an
 * unconsumed third statement of "mine is the default" would have been a DRY liability, not a DRY win, so it
 * (and its dedicated test) were removed rather than force-fed an artificial caller.
 */
import type { RecipeDetail, UpdateRecipeInput } from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useUpdateRecipe } from '@kitchensink/recipe-service-client/hooks';
import { useCallback, useEffect, useState } from 'react';

import {
    applyDraftToRecipeDetail,
    defaultRecipeFormValues,
    toRecipeFormValues,
    toUpdateRecipeInput,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormValues,
} from '../form/model.js';
import { composeMergedRecipe, type RecipeMergeSelections } from '../versions/model.js';

/**
 * The recipe-edit lifecycle. See the module doc above for the ordering rationale (mirrors `deriveAuthState`'s
 * deliberate-ordering convention): `loading` while the recipe has not yet seeded the draft; `editing` for the
 * normal, idle-form state; `submitting` while a save is in flight; `conflict` after a 409 (carries both
 * sides of the conflict, the draft that lost the race, and the in-progress merge selections); `saved` once a
 * write has succeeded (the caller's `onSaved` fires on the SAME transition — most callers navigate away
 * immediately, so this status is normally transient).
 *
 * **`saved` is reset on every transition that resumes editing**, not just set-once: a consumer that does NOT
 * unmount on `onSaved` (a multi-step wizard) can keep the machine alive past a successful save, so the
 * `saved` flag is cleared on `setValues`/`setField` (any fresh edit), on a reseed (the seed-once effect and
 * `useTheirs`), and on entering/resolving `conflict` (`keepMine`/`merge`'s resubmit, and `useTheirs`).
 * Without this, a save followed by further editing and a 409 could exit `conflict` back into a stale `saved`
 * display instead of `editing` — see the hook's tests under "saved latch".
 */
export type EditorState =
    | { readonly status: 'loading' }
    | { readonly status: 'editing' }
    | { readonly status: 'submitting' }
    | {
          readonly status: 'conflict';
          /** The latest saved recipe that landed while the user was editing (its `currentVersion` is the fresh CAS token). */
          readonly theirs: RecipeDetail;
          /** The user's in-progress draft projected onto `theirs`, for side-by-side display. */
          readonly mine: RecipeDetail;
          /** The draft the user attempted to save (source of a "keep mine" resubmit). */
          readonly draft: RecipeFormValues;
          /** The in-progress per-field merge resolution; owned here so `RecipeConflictView` can be controlled. */
          readonly mergeSelections: RecipeMergeSelections;
      }
    | { readonly status: 'saved' };

/** A conflict snapshot mirrors the `conflict` variant of {@link EditorState} minus its `status` discriminant. */
type ConflictInfo = Extract<EditorState, { status: 'conflict' }>;

/** Options for {@link useRecipeEditor}. */
export interface UseRecipeEditorOptions {
    /** Called with the freshly-persisted recipe immediately after a successful save. */
    readonly onSaved: (recipe: RecipeDetail) => void;
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
    /** Whether the last submit failed for a reason OTHER than a version conflict (a handled 409 is never this). */
    readonly submitError: boolean;
    /** The underlying recipe query's load state, for the container's own loading/error/not-found rendering. */
    readonly query: RecipeEditorQueryState;
    /** The three FR-007c conflict resolutions, plus the merge-selection setter the controlled conflict view binds to. */
    readonly resolutions: {
        /** Re-submit the draft against the latest saved version, forcing it to win. */
        readonly keepMine: () => void;
        /** Discard the draft and reseed `values` from the latest saved recipe (the SAME transition as the initial seed). */
        readonly useTheirs: () => void;
        /** Compose the merged draft from `selections` (`composeMergedRecipe`) and submit it against the latest saved version. */
        readonly merge: (selections: RecipeMergeSelections) => void;
        /** Update the in-progress per-field merge selections (a no-op outside `status: 'conflict'`). */
        readonly setMergeSelections: (selections: RecipeMergeSelections) => void;
    };
}

/**
 * The shared recipe-edit lifecycle statechart.
 *
 * @param recipeId - The id of the recipe being edited.
 * @param opts - `onSaved`, invoked with the persisted recipe on every successful save.
 * @returns The edit state, the controlled draft, and the submit/resolution actions.
 */
export function useRecipeEditor(recipeId: string, opts: UseRecipeEditorOptions): UseRecipeEditorResult {
    const query = useRecipe(recipeId);
    const updateRecipe = useUpdateRecipe();

    const [values, setValuesState] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [seededId, setSeededId] = useState<string | null>(null);
    const [conflict, setConflict] = useState<ConflictInfo | null>(null);
    const [saved, setSaved] = useState(false);

    // Seed the draft from the loaded recipe once; the STATE guard (not a ref, per the coding standards' "refs
    // near-forbidden" rule) keeps a background refetch of the SAME recipe from overwriting in-progress edits —
    // only a genuinely different id (a real navigation to another recipe) reseeds.
    useEffect(() => {
        if (query.data !== undefined && seededId !== query.data.id) {
            setSeededId(query.data.id);
            setValuesState(toRecipeFormValues(query.data));
            // A reseed (a real navigation to a different recipe) always resumes editing, never leaves `saved`
            // dangling from whatever the PREVIOUS recipe's edit lifecycle last did.
            setSaved(false);
        }
    }, [query.data, seededId]);

    // A rejected update for a stale version enters conflict mode against the freshly-refetched server recipe;
    // any other error leaves the machine at `editing` (via `updateRecipe`'s own settled isPending/isError).
    const handleUpdateError = async (err: unknown, draft: RecipeFormValues): Promise<void> => {
        if (!isVersionConflictError(err)) {
            return;
        }

        const refetched = await query.refetch();
        const theirs = refetched.data ?? query.data;

        if (theirs === undefined) {
            return;
        }

        setConflict({
            status: 'conflict',
            theirs,
            mine: applyDraftToRecipeDetail(theirs, draft),
            draft,
            mergeSelections: {},
        });
        // Entering conflict always resumes editing (the user must resolve it); never let a stale `saved` from
        // an earlier successful save in this same hook instance resurface once the conflict itself clears.
        setSaved(false);
    };

    // Persist `draft` with the given optimistic-concurrency token; report success upward, resolve conflicts on 409.
    const submitDraft = (draft: RecipeFormValues, expectedVersion: number): void => {
        const input: UpdateRecipeInput = { ...toUpdateRecipeInput(draft), expectedVersion };

        updateRecipe.mutate(
            { id: recipeId, input },
            {
                onSuccess: (recipe) => {
                    setConflict(null);
                    setSaved(true);
                    opts.onSaved(recipe);
                },
                onError: (err) => void handleUpdateError(err, draft),
            },
        );
    };

    // The controlled draft's public mutators. Both reset the `saved` latch — resuming an edit after a
    // successful save (a wizard that stays mounted past `onSaved`) must fall back to `editing`, not keep
    // reporting a stale `saved` from before this edit. `useCallback` (empty deps: `setSaved`/`setValuesState`
    // are the stable dispatchers `useState` returns) keeps these referentially stable across renders, same as
    // the raw `useState` setter `setValues` wrapped before this fix.
    const setValues = useCallback((next: RecipeFormValues): void => {
        setSaved(false);
        setValuesState(next);
    }, []);

    const setField = useCallback(<K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]): void => {
        setSaved(false);
        setValuesState((current) => ({ ...current, [field]: value }));
    }, []);

    const submit = (): void => {
        const nextErrors = validateRecipeForm(values);
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0 || query.data === undefined) {
            return;
        }

        submitDraft(values, query.data.currentVersion);
    };

    const resolutions: UseRecipeEditorResult['resolutions'] = {
        keepMine: (): void => {
            if (conflict === null) {
                return;
            }

            // Resuming into a resubmit is a fresh editing attempt, not a continuation of a prior `saved`.
            setSaved(false);
            submitDraft(conflict.draft, conflict.theirs.currentVersion);
        },
        useTheirs: (): void => {
            if (conflict === null) {
                return;
            }

            // The SAME reseed transition the initial seed-once effect uses — this is the fix for the reseed
            // incompatibility: no remount, no seed override, just `setValues`.
            setValuesState(toRecipeFormValues(conflict.theirs));
            setErrors({});
            setConflict(null);
            setSaved(false);
        },
        merge: (selections: RecipeMergeSelections): void => {
            if (conflict === null) {
                return;
            }

            const merged = composeMergedRecipe(conflict.draft, toRecipeFormValues(conflict.theirs), selections);
            setSaved(false);
            submitDraft(merged, conflict.theirs.currentVersion);
        },
        setMergeSelections: (selections: RecipeMergeSelections): void => {
            setConflict((current) => (current === null ? current : { ...current, mergeSelections: selections }));
        },
    };

    const state: EditorState =
        seededId === null
            ? { status: 'loading' }
            : (conflict ??
              (saved
                  ? { status: 'saved' }
                  : updateRecipe.isPending
                    ? { status: 'submitting' }
                    : { status: 'editing' }));

    return {
        state,
        values,
        errors,
        setValues,
        setField,
        submit,
        submitError: updateRecipe.isError && !isVersionConflictError(updateRecipe.error),
        query: { isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch },
        resolutions,
    };
}
