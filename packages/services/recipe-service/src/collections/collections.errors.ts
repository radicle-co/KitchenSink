/**
 * Collections-domain throwables. These are structural {@link RecipeError}s (they carry a
 * {@link RecipeErrorCode} `code`) so the service-wide `ApiExceptionFilter` maps them to the correct
 * HTTP status via `isRecipeError` — NOT_OWNER → 403, RECIPE_NOT_FOUND → 404, INVALID_VISIBILITY → 400.
 *
 * The class extends `Error` (per CODING_STANDARDS custom-error convention: `Object.setPrototypeOf` +
 * an `is*` guard) while also satisfying the `RecipeError` contract, so a single thrown value works
 * both as a real stack-bearing Error and as the filter's structural domain error.
 *
 * There is deliberately no `COLLECTION_NOT_FOUND` code in the shared enum: a missing collection is a
 * framework `NotFoundException` (→ 404, passed through untouched by the filter), so existence is only
 * revealed to the owner (a collection owned by someone else surfaces NOT_OWNER → 403, per the OpenAPI
 * contract's 403/404 split).
 */
import { RecipeErrorCode, type RecipeError } from '@kitchensink/recipe-core';

/** A collections-domain error that is both a real `Error` and a structural {@link RecipeError}. */
export class CollectionError extends Error implements RecipeError {
    public readonly code: RecipeError['code'];
    public readonly details?: Record<string, unknown>;

    public constructor(code: RecipeError['code'], message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'CollectionError';
        this.code = code;

        if (details !== undefined) {
            this.details = details;
        }

        Object.setPrototypeOf(this, CollectionError.prototype);
    }
}

/** Type guard for {@link CollectionError}. */
export const isCollectionError = (value: unknown): value is CollectionError => value instanceof CollectionError;

/** The caller does not own the collection (→ 403). */
export const collectionNotOwnedError = (collectionId: string): CollectionError =>
    new CollectionError(RecipeErrorCode.NOT_OWNER, 'You do not own this collection.', { collectionId });

/** The recipe to add does not exist (or is tombstoned, hence excluded from every read path) (→ 404). */
export const recipeNotFoundError = (recipeId: string): CollectionError =>
    new CollectionError(RecipeErrorCode.RECIPE_NOT_FOUND, 'Recipe not found.', { recipeId });

/** The requested visibility is not one of `public` | `private` (→ 400). */
export const invalidVisibilityError = (visibility: string): CollectionError =>
    new CollectionError(RecipeErrorCode.INVALID_VISIBILITY, `Invalid collection visibility: ${visibility}`, {
        visibility,
    });
