/**
 * Recipe-photo domain errors. Re-uses the shared {@link RecipeDomainError} (a real `Error` that also
 * satisfies the structural `RecipeError` contract), so the global `ApiExceptionFilter` maps `code` →
 * HTTP status + `{ code, message, details? }` envelope exactly as it does for the recipes vertical.
 *
 * Only the 10-photos-per-recipe cap is a genuine DOMAIN error (`MAX_PHOTOS_EXCEEDED` → 409). Input
 * validation failures (unsupported/oversize/corrupt uploads) are surfaced by the service as framework
 * `HttpException`s, which the filter preserves untouched — they are not recipe-domain errors.
 */
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipeDomainError } from '../recipes/recipe.error.js';

export { RecipeDomainError, isRecipeDomainError } from '../recipes/recipe.error.js';

/**
 * `MAX_PHOTOS_EXCEEDED` — the recipe already holds the maximum number of photos, so no further upload
 * may be confirmed. `details` carries the cap for the client.
 */
export function maxPhotosExceeded(recipeId: string, limit: number): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.MAX_PHOTOS_EXCEEDED,
        `Recipe ${recipeId} already has the maximum of ${limit} photos.`,
        { limit },
    );
}
