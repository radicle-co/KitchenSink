/**
 * Collections-domain throwables. These are the shared {@link RecipeDomainError} (a real stack-bearing
 * `Error` that also satisfies the structural {@link RecipeError} contract), so the service-wide
 * `ApiExceptionFilter` maps them to the correct HTTP status via `isRecipeError` — NOT_OWNER → 403,
 * RECIPE_NOT_FOUND → 404, INVALID_VISIBILITY → 400.
 *
 * There was previously a near-verbatim `CollectionError` copy of `RecipeDomainError` here; it has been
 * folded into the ONE domain-error type (ARCH-BE-6) so every recipe-service error egresses the single
 * `{ code, message, details }` envelope. These factories are thin, domain-named constructors over it.
 *
 * There is deliberately no `COLLECTION_NOT_FOUND` code in the shared enum: a missing collection is a
 * framework `NotFoundException` (→ 404, passed through untouched by the filter), so existence is only
 * revealed to the owner (a collection owned by someone else surfaces NOT_OWNER → 403, per the OpenAPI
 * contract's 403/404 split).
 */
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipeDomainError } from '../recipes/recipe.error.js';
import type { PullDiff } from './domain/pull-diff.js';

/** The caller does not own the collection (→ 403). */
export const collectionNotOwnedError = (collectionId: string): RecipeDomainError =>
    new RecipeDomainError(RecipeErrorCode.NOT_OWNER, 'You do not own this collection.', { collectionId });

/** The recipe to add does not exist (or is tombstoned, hence excluded from every read path) (→ 404). */
export const recipeNotFoundError = (recipeId: string): RecipeDomainError =>
    new RecipeDomainError(RecipeErrorCode.RECIPE_NOT_FOUND, 'Recipe not found.', { recipeId });

/** The requested visibility is not one of `public` | `private` (→ 400). */
export const invalidVisibilityError = (visibility: string): RecipeDomainError =>
    new RecipeDomainError(RecipeErrorCode.INVALID_VISIBILITY, `Invalid collection visibility: ${visibility}`, {
        visibility,
    });

/**
 * A pull-from-source was requested for a collection that has no source to pull FROM (→ 400).
 *
 * Either it was authored directly (never cloned), or its `source_collection_id` was orphaned when the
 * source was deleted (`ON DELETE SET NULL`, T119). Both are a client asking for something this
 * collection cannot do, so they surface as a distinguishable 400 rather than a silent no-op — a no-op
 * would be indistinguishable from "pulled, nothing new" and hide the misuse (FR-011).
 */
export const collectionNotClonedError = (collectionId: string): RecipeDomainError =>
    new RecipeDomainError(
        RecipeErrorCode.COLLECTION_NOT_CLONED,
        'This collection was not cloned from a source, so there is nothing to pull from.',
        { collectionId },
    );

/**
 * A pull-from-source commit drifted since the client's preview (W8-a.8 / decision 7) — the source OR the
 * caller's own clone membership changed, so the previewed diff no longer matches (→ 409). The FRESH diff
 * rides `details` so the client re-previews rather than silently applying a set the user did not confirm.
 */
export const pullDriftError = (collectionId: string, freshDiff: PullDiff): RecipeDomainError =>
    new RecipeDomainError(
        RecipeErrorCode.PULL_DRIFT,
        'The source changed since you previewed this pull. Review the updated changes before applying.',
        { collectionId, diff: freshDiff },
    );
