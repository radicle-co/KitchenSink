/**
 * `RecipeDomainError` — the concrete throwable for recipe-domain failures.
 *
 * It is a real `Error` subclass (so stacks/logging work) that ALSO satisfies the structural
 * {@link RecipeError} contract from `@kitchensink/recipe-core` (`{ code, message, details? }`). The
 * global `ApiExceptionFilter` recognizes it via `isRecipeError` and maps `code` → HTTP status +
 * `{ code, message, details? }` envelope, so throwing this class is all a service/DAL needs to do.
 */
import { RecipeErrorCode, type RecipeError, type VersionConflictSide } from '@kitchensink/recipe-core';

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

/**
 * `RECIPE_NOT_FOUND` (→ 404) reused for a missing catalog ingredient — the ingredient picker surfaces
 * "not found" through the same code the filter already maps, rather than a bare error object.
 */
export function ingredientNotFound(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.RECIPE_NOT_FOUND, `Ingredient '${id}' not found`);
}

/**
 * `UNKNOWN_INGREDIENT` (→ 400) — Stage 2: the picked food-catalog hit cannot back an ingredient row.
 *
 * Raised by `POST /api/v1/ingredients/by-food` when the referenced food has no usable golden record: it is
 * unknown/terminal to the food service, still mid-resolution (`PENDING`/`UNRESOLVED`), or resolved but
 * nameless. A single code covers all three deliberately — from the caller's side they are one fact ("this
 * food id is not admissible as an ingredient right now"), and collapsing them avoids confirming whether a
 * given opaque food id exists in the food catalog.
 *
 * A 400 rather than a 404 because the honest failure is the REQUEST (a stale or hand-crafted `foodId`), not a
 * missing recipe-service resource — and the caller's remedy is a different action (`by-name` or freeform),
 * not a retry. `details.foodId` carries the id back for diagnosis.
 */
export function foodNotAdmissible(foodId: string, reason: string): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.UNKNOWN_INGREDIENT,
        `Food '${foodId}' cannot back an ingredient: ${reason}.`,
        { foodId },
    );
}

/** `NOT_OWNER` — the authenticated principal does not own the recipe. */
export function notOwner(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.NOT_OWNER, `Recipe ${id} is not owned by the caller.`);
}

/**
 * `UNKNOWN_INGREDIENT` — a recipe ingredient line references an `ingredientId` that has no row in the
 * shared ingredients catalog. The client must resolve ingredients (via `/api/v1/ingredients`) before
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
 * `CANNOT_RATE_OWN_RECIPE` (→ 403) — the caller tried to rate a recipe they own (FR-013). A 403 is
 * correct and leaks nothing here: the owner already knows their own recipe exists. This is deliberately
 * distinct from the IDOR case — rating a recipe the caller CANNOT see is a 404 `RECIPE_NOT_FOUND`
 * ({@link recipeNotFound}), so an unreadable recipe is indistinguishable from a missing one.
 */
export function cannotRateOwnRecipe(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.CANNOT_RATE_OWN_RECIPE, `Recipe ${id} cannot be rated by its owner.`);
}

/**
 * `VERSION_CONFLICT` — the client's `expectedVersion` no longer matches the stored `currentVersion`
 * (optimistic-concurrency loss, T033). `details` always carries both version numbers; when `sides` is
 * supplied (W8-a.5, the owner-gated update path) it additionally carries the `server` (current winning)
 * snapshot and, when still retained, the `base` snapshot — read coherently — so the conflict UI can
 * 3-way merge without a second round-trip. `currentVersion` is the concurrency token the resolve echoes.
 */
export function versionConflict(
    currentVersion: number,
    conflictingVersion: number,
    sides?: { server: VersionConflictSide; base?: VersionConflictSide },
): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.VERSION_CONFLICT, 'Recipe version conflict', {
        currentVersion,
        conflictingVersion,
        ...(sides !== undefined
            ? { server: sides.server, ...(sides.base !== undefined ? { base: sides.base } : {}) }
            : {}),
    });
}

/**
 * `INVALID_VISIBILITY` — the requested visibility transition is denied by the C-004 policy (T048 / T050),
 * e.g. a free-tier user making a recipe private, or making an imported physical/paid recipe public. The
 * evaluator's deny-`reason` becomes the message; `details` carries the attempted visibility + source type.
 * Reuses the shared code already mapped to 400 by `ApiExceptionFilter`.
 */
export function invalidVisibility(reason: string, details?: Record<string, unknown>): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.INVALID_VISIBILITY, reason, details);
}
