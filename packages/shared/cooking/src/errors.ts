/**
 * Custom errors for Cooking Mode session state.
 *
 * Each follows the repository convention: extend `Error`, set `name`, call `Object.setPrototypeOf`
 * (so `instanceof` survives the ES5 target), and ship a matching `is*` type guard.
 */

/** Raised when a caller toggles an ingredient id that the current recipe does not contain. */
export class UnknownIngredientError extends Error {
    public constructor(public readonly ingredientId: string) {
        super(`Unknown ingredient: ${ingredientId}`);
        this.name = 'UnknownIngredientError';
        Object.setPrototypeOf(this, UnknownIngredientError.prototype);
    }
}

/**
 * Type guard for {@link UnknownIngredientError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link UnknownIngredientError}.
 */
export function isUnknownIngredientError(error: unknown): error is UnknownIngredientError {
    return error instanceof UnknownIngredientError;
}

/** Raised when a caller requests a yield scale factor outside the supported set. */
export class UnsupportedScaleFactorError extends Error {
    public constructor(public readonly factor: number) {
        super(`Unsupported scale factor: ${factor}`);
        this.name = 'UnsupportedScaleFactorError';
        Object.setPrototypeOf(this, UnsupportedScaleFactorError.prototype);
    }
}

/**
 * Type guard for {@link UnsupportedScaleFactorError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link UnsupportedScaleFactorError}.
 */
export function isUnsupportedScaleFactorError(error: unknown): error is UnsupportedScaleFactorError {
    return error instanceof UnsupportedScaleFactorError;
}

/** Raised when an ingredient quantity is not a finite, non-negative number. */
export class InvalidQuantityError extends Error {
    public constructor(public readonly quantity: number) {
        super(`Invalid quantity: ${quantity}`);
        this.name = 'InvalidQuantityError';
        Object.setPrototypeOf(this, InvalidQuantityError.prototype);
    }
}

/**
 * Type guard for {@link InvalidQuantityError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link InvalidQuantityError}.
 */
export function isInvalidQuantityError(error: unknown): error is InvalidQuantityError {
    return error instanceof InvalidQuantityError;
}
