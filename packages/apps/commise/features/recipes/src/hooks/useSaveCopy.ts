/**
 * @module @commise/features-recipes/hooks — "Save a copy" from a card (`docs/architecture/uiOverhaulBlueprint.md` A14;
 * `docs/design/uiOverhaul/buildSpec.md` §4.1).
 *
 * The mutation is the source of truth. Each card derives its control from `useMutationState` over the clone mutation's
 * key: the icon fills while a copy is being made and stays filled once it exists, and a second press while saving or
 * saved sends nothing. There is no cache pre-write — the copy has no id until the server answers — and no outbox: there
 * is no `clone` intent, and offline gives the ordinary error (the control unfills and an inline alert says so).
 *
 * "Saved" is remembered for the session only (the clone mutation keeps its result for the session, not forever); whether
 * "already copied" must survive a reload needs a server fact (blueprint Q8).
 *
 * @pattern Command — the clone mutation, whose observable state each card renders
 * @pattern Observer — `useMutationState` subscribes each card's control to the mutation cache
 */
import { useMessages } from '@commise/i18n/react';
import { useSnackbar } from '@commise/ui/snackbar';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { SAVE_COPY_MUTATION_KEY, useCloneRecipe } from '@kitchensink/recipe-service-client/hooks';
import { useMutationState } from '@tanstack/react-query';

import { recipeActionMessages } from '../actions/messages.js';

/** What a card's Save a copy control is showing for one recipe. */
export type SaveCopyState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'saving' }
    | { readonly kind: 'saved'; readonly copyId: string }
    | { readonly kind: 'failed' };

/** What the hook reads off one clone mutation. */
interface CloneAttempt {
    readonly recipeId: string;
    readonly status: 'idle' | 'pending' | 'success' | 'error';
    readonly copyId: string | undefined;
    readonly submittedAt: number;
}

/**
 * The state of one recipe's control: that of its LATEST attempt. A failure followed by a retry reads as the retry, and
 * an earlier success is never overwritten by a later failure (a second press is refused once saved, so none is made).
 * Pure.
 *
 * @param attempts - Every clone attempt this session, in any order.
 * @param recipeId - The recipe whose control is asked about.
 * @returns The control's state.
 */
export function saveCopyStateOf(attempts: readonly CloneAttempt[], recipeId: string): SaveCopyState {
    const latest = attempts
        .filter((attempt) => attempt.recipeId === recipeId)
        .reduce<CloneAttempt | undefined>(
            (best, attempt) => (best === undefined || attempt.submittedAt > best.submittedAt ? attempt : best),
            undefined,
        );

    if (latest === undefined || latest.status === 'idle') {
        return { kind: 'idle' };
    }

    if (latest.status === 'pending') {
        return { kind: 'saving' };
    }

    if (latest.status === 'error') {
        return { kind: 'failed' };
    }

    return latest.copyId === undefined ? { kind: 'idle' } : { kind: 'saved', copyId: latest.copyId };
}

/** What a surface gets to draw its cards' Save a copy controls. */
export interface SaveCopy {
    /** The control's state for one recipe. */
    readonly stateOf: (recipeId: string) => SaveCopyState;
    /** Press the control: starts a copy, unless one is saving or saved for this recipe. */
    readonly save: (recipeId: string) => void;
}

/**
 * Save-a-copy for every card on a surface.
 *
 * @param onEdit - Open the copy in the editor; the snackbar's Edit calls it with the COPY's id.
 * @returns Each recipe's control state and the press.
 * @sideEffect Starts a clone request and shows a snackbar.
 */
export function useSaveCopy(onEdit: (copyId: string) => void): SaveCopy {
    const copyCopy = useMessages(recipeActionMessages).saveCopy;
    const snackbar = useSnackbar();
    const clone = useCloneRecipe();
    const attempts = useMutationState<CloneAttempt>({
        filters: { mutationKey: SAVE_COPY_MUTATION_KEY },
        select: (mutation) => ({
            recipeId: String(mutation.state.variables),
            status: mutation.state.status,
            copyId: (mutation.state.data as RecipeDetail | undefined)?.id,
            submittedAt: mutation.state.submittedAt,
        }),
    });

    const stateOf = (recipeId: string): SaveCopyState => saveCopyStateOf(attempts, recipeId);

    return {
        stateOf,
        save: (recipeId) => {
            const state = stateOf(recipeId);

            if (state.kind === 'saving' || state.kind === 'saved') {
                return;
            }

            clone.mutate(recipeId, {
                onSuccess: (copy) =>
                    snackbar.show({
                        message: copyCopy.snackbar,
                        action: { label: copyCopy.edit, onAction: () => onEdit(copy.id) },
                    }),
            });
        },
    };
}
