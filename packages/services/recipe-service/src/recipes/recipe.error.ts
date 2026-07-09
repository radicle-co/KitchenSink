/**
 * `RecipeDomainError` — the concrete throwable for recipe-domain failures.
 *
 * It is a real `Error` subclass (so stacks/logging work) that ALSO satisfies the structural
 * {@link RecipeError} contract from `@kitchensink/recipe-core` (`{ code, message, details? }`). The
 * global `ApiExceptionFilter` recognizes it via `isRecipeError` and maps `code` → HTTP status +
 * `{ code, message, details? }` envelope, so throwing this class is all a service/DAL needs to do.
 */
import { RecipeErrorCode, type RecipeError } from '@kitchensink/recipe-core';

/** A thrown recipe-domain error carrying a machine-readable {@link RecipeErrorCode}. */
export class RecipeDomainError extends Error implements RecipeError {
    /** The machine-readable domain error code (drives the HTTP-status mapping). */
    public readonly code: RecipeErrorCode;

    /** Optional structured payload surfaced under the response `details` key. */
    public readonly details?: Record<string, unknown>;

    public constructor(code: RecipeErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'RecipeDomainError';
        this.code = code;

        if (details !== undefined) {
            this.details = details;
        }

        // Restore the prototype chain (transpilation to ES targets breaks `instanceof` otherwise).
        Object.setPrototypeOf(this, RecipeDomainError.prototype);
    }
}

/** Type guard for {@link RecipeDomainError} instances. */
export function isRecipeDomainError(value: unknown): value is RecipeDomainError {
    return value instanceof RecipeDomainError;
}

/** `RECIPE_NOT_FOUND` — no active recipe with that id (or it is soft-deleted). */
export function recipeNotFound(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.RECIPE_NOT_FOUND, `Recipe ${id} not found.`);
}

/** `NOT_OWNER` — the authenticated principal does not own the recipe. */
export function notOwner(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.NOT_OWNER, `Recipe ${id} is not owned by the caller.`);
}

/**
 * `UNKNOWN_INGREDIENT` — a recipe ingredient line references an `ingredientId` that has no row in the
 * shared ingredients catalog. The client must resolve ingredients (via `/v1/ingredients`) before
 * attaching them to a recipe; this fails the write fast with a 400 instead of a raw FK 500.
 */
export function unknownIngredient(ingredientId: string): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.UNKNOWN_INGREDIENT,
        `Ingredient ${ingredientId} does not exist in the catalog.`,
        { ingredientId },
    );
}

/**
 * `VERSION_CONFLICT` — the client's `expectedVersion` no longer matches the stored `currentVersion`
 * (optimistic-concurrency loss, T033). `details` carries both versions for the 409 payload.
 */
export function versionConflict(currentVersion: number, conflictingVersion: number): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.VERSION_CONFLICT, 'Recipe version conflict', {
        currentVersion,
        conflictingVersion,
    });
}
