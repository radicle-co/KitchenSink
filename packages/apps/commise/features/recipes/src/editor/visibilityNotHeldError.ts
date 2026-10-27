/**
 * @module @commise/features-recipes/editor — the error a first Publish reports when the visibility it wrote first was
 * not held by the server's answer.
 */

/** The visibility write answered, but not with the visibility and version the Publish needs. */
export class VisibilityNotHeldError extends Error {
    public constructor(recipeId: string) {
        super(`The server did not hold the visibility just written for recipe ${recipeId}.`);
        this.name = 'VisibilityNotHeldError';
        Object.setPrototypeOf(this, VisibilityNotHeldError.prototype);
    }
}

/**
 * Whether a value is a {@link VisibilityNotHeldError}. Pure.
 *
 * @param value - Anything caught or reported.
 */
export function isVisibilityNotHeldError(value: unknown): value is VisibilityNotHeldError {
    return value instanceof VisibilityNotHeldError;
}
