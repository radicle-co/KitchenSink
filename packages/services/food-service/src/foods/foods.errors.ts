/**
 * Typed error hierarchy for the `/v1/foods/*` read API.
 *
 * Every error extends `Error`, calls `Object.setPrototypeOf` (so `instanceof` survives
 * transpilation), and ships a matching `is*` type guard per the project constitution
 * (NFR-009). These are mapped to HTTP responses by {@link FoodsController}; internal
 * details are never leaked to the caller.
 */

/** Base class for all foods-domain errors. */
export class FoodsError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'FoodsError';
        Object.setPrototypeOf(this, FoodsError.prototype);
    }
}

/** Type guard for {@link FoodsError}. */
export function isFoodsError(error: unknown): error is FoodsError {
    return error instanceof FoodsError;
}

/**
 * Thrown when a requested food has no fetched record yet (miss, pending, or tombstone-lapsed
 * re-attempt). Carries the enqueue outcome so the controller can return `202 Accepted`.
 */
export class FoodPendingError extends FoodsError {
    /** The FDC id that was enqueued / is pending. */
    public readonly fdcId: number;

    /** Best-effort estimate of seconds until the food is available. */
    public readonly estimatedWaitSeconds: number;

    public constructor(fdcId: number, estimatedWaitSeconds: number) {
        super(`Food ${fdcId} is pending`);
        this.name = 'FoodPendingError';
        this.fdcId = fdcId;
        this.estimatedWaitSeconds = estimatedWaitSeconds;
        Object.setPrototypeOf(this, FoodPendingError.prototype);
    }
}

/** Type guard for {@link FoodPendingError}. */
export function isFoodPendingError(error: unknown): error is FoodPendingError {
    return error instanceof FoodPendingError;
}

/**
 * Thrown when a food is tombstoned (`fetch_status = 'not_found'`) and still within its
 * tombstone TTL (FR-025). Mapped to `404 Not Found` with no enqueue.
 */
export class FoodNotFoundError extends FoodsError {
    /** The FDC id that is tombstoned / absent. */
    public readonly fdcId: number;

    public constructor(fdcId: number) {
        super(`Food ${fdcId} not found`);
        this.name = 'FoodNotFoundError';
        this.fdcId = fdcId;
        Object.setPrototypeOf(this, FoodNotFoundError.prototype);
    }
}

/** Type guard for {@link FoodNotFoundError}. */
export function isFoodNotFoundError(error: unknown): error is FoodNotFoundError {
    return error instanceof FoodNotFoundError;
}
