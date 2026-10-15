'use client';

/**
 * @module @commise/features-recipes/actions — whether the server refused a Private for this recipe AFTER it was sent
 * (plan 2026-10-14-009, the stuck-save review).
 *
 * The client does not send a Private it knows will be refused (`privateRefusalOf`). An unknown state (a failed profile
 * read) or a stale one (a role removed under a cached profile) still sends it, and the editor's follow-up is answered
 * after the editor has navigated to the recipe, so its refusal would otherwise be said nowhere. The recipe page reads
 * the LATEST visibility write for its recipe from the mutation cache (`RECIPE_VISIBILITY_MUTATION_KEY`): a later write
 * that succeeds, or one the page makes itself, replaces it.
 *
 * @pattern Observer — `useMutationState` subscribes the page to the visibility writes in the cache, whoever sent them
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { isBadRequestError } from '@kitchensink/recipe-service-client';
import { RECIPE_VISIBILITY_MUTATION_KEY } from '@kitchensink/recipe-service-client/hooks';
import { useMutationState } from '@tanstack/react-query';

/** A visibility write as the cache holds it. */
interface VisibilityAttempt {
    readonly variables: { readonly id: string; readonly visibility: RecipeVisibility } | undefined;
    readonly error: unknown;
}

/**
 * Whether the latest visibility write for `recipeId` was a Private the server refused as `INVALID_VISIBILITY`.
 *
 * @param recipeId - The recipe the page shows.
 * @returns `true` only for that refusal; any other failure keeps the page's generic message.
 * @sideEffect Subscribes to the mutation cache.
 */
export function useServerRefusedPrivate(recipeId: string): boolean {
    const attempts = useMutationState<VisibilityAttempt>({
        filters: {
            mutationKey: RECIPE_VISIBILITY_MUTATION_KEY,
            predicate: (mutation) => (mutation.state.variables as VisibilityAttempt['variables'])?.id === recipeId,
        },
        select: (mutation) => ({
            variables: mutation.state.variables as VisibilityAttempt['variables'],
            error: mutation.state.error,
        }),
    });
    const latest = attempts.at(-1);

    return (
        latest?.variables?.visibility === RecipeVisibility.PRIVATE &&
        isBadRequestError(latest.error) &&
        latest.error.code === 'INVALID_VISIBILITY'
    );
}
