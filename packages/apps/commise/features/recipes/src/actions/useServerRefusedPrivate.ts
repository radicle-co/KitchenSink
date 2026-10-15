'use client';

/**
 * @module @commise/features-recipes/actions — whether the server refused a Private for this recipe AFTER it was sent,
 * and why (plan 2026-10-14-009, the stuck-save review).
 *
 * The client does not send a Private it knows will be refused (`privateRefusalOf`). An unknown state (a failed profile
 * read) or a stale one (a role removed under a cached profile) still sends it, and the editor's follow-up is answered
 * after the editor has navigated to the recipe, so its refusal would otherwise be said nowhere. The recipe page reads
 * the LATEST visibility write for its recipe from the mutation cache (`RECIPE_VISIBILITY_MUTATION_KEY`): a later write
 * that succeeds, or one the page makes itself, replaces it.
 *
 * @pattern Observer — `useMutationState` subscribes the page to the visibility writes in the cache, whoever sent them
 */
import type { PaidFeatureState } from '@commise/features-account';
import { RecipeVisibility, recipeVisibilitySchema } from '@kitchensink/recipe-core';
import { isBadRequestError } from '@kitchensink/recipe-service-client';
import {
    RECIPE_VISIBILITY_MUTATION_KEY,
    type RecipeVisibilityVariables,
} from '@kitchensink/recipe-service-client/hooks';
import { useMutationState, type Mutation } from '@tanstack/react-query';
import { z } from 'zod';

import { serverRefusalOf, type PrivateRefusal } from './privateGate.js';

/** A visibility write as the cache holds it. */
interface VisibilityAttempt {
    readonly variables: RecipeVisibilityVariables | undefined;
    readonly error: unknown;
}

/** The visibility mutation's own variables. */
const visibilityVariablesSchema = z.object({ id: z.string(), visibility: recipeVisibilitySchema });

/**
 * Read a cached write's variables as the visibility mutation's own variables type. The cache holds every mutation's
 * variables as `unknown`, and the key names only ours, so this parses the shape rather than claiming it.
 */
function visibilityVariablesOf(variables: unknown): RecipeVisibilityVariables | undefined {
    const parsed = visibilityVariablesSchema.safeParse(variables);

    return parsed.success ? parsed.data : undefined;
}

const attemptOf = (mutation: Mutation): VisibilityAttempt => ({
    variables: visibilityVariablesOf(mutation.state.variables),
    error: mutation.state.error,
});

/**
 * Why the latest visibility write for `recipeId` was refused, when it was a Private the server refused as
 * `INVALID_VISIBILITY`.
 *
 * @param recipeId - The recipe the page shows.
 * @param known - The profile's own answer (`knownPaidFeaturesOf`), which picks the words.
 * @returns The refusal's reason, or `undefined` when there is no such refusal; any other failure keeps the page's
 *     generic message.
 * @sideEffect Subscribes to the mutation cache.
 */
export function useServerRefusedPrivate(
    recipeId: string,
    known: PaidFeatureState | undefined,
): PrivateRefusal | undefined {
    const attempts = useMutationState<VisibilityAttempt>({
        filters: {
            mutationKey: RECIPE_VISIBILITY_MUTATION_KEY,
            predicate: (mutation) => attemptOf(mutation).variables?.id === recipeId,
        },
        select: attemptOf,
    });
    const latest = attempts.at(-1);
    const refused =
        latest?.variables?.visibility === RecipeVisibility.PRIVATE &&
        isBadRequestError(latest.error) &&
        latest.error.code === 'INVALID_VISIBILITY';

    return refused ? serverRefusalOf(known) : undefined;
}
