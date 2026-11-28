/**
 * @module @commise/features-recipes/versions — what the version history's failed state says and offers, for both apps.
 *
 * A 404 is final: the recipe was deleted, made private or hidden, and nothing says which, so the shared reader sentence
 * is said and trying again is not offered. Any other failure says the load error and retries.
 *
 * Pure.
 *
 * @pattern Specification — a pure pick over the failure, decided once for web and native
 */
import { isNotFoundError } from '@kitchensink/recipe-service-client';

import type { RecipeVersionListMessages } from './messages.js';
import type { RecipeVersionListErrorProps } from './RecipeVersionListError.js';

/**
 * @param error - What the read failed with.
 * @param copy - The history's copy and the shared reader sentence.
 * @param onRetry - Read again: the boundary's reset.
 * @returns The words, and the retry only when the failure is not a 404.
 */
export function versionListErrorOf(
    error: unknown,
    copy: { readonly versionList: RecipeVersionListMessages; readonly recipeUnavailable: string },
    onRetry: () => void,
): RecipeVersionListErrorProps {
    return isNotFoundError(error)
        ? { title: copy.recipeUnavailable }
        : { title: copy.versionList.loadError, retryLabel: copy.versionList.retry, onRetry };
}
