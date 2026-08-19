/**
 * Typed error hierarchy for the source-agnostic food DAOs (feature 003, Phase 1).
 *
 * Every error extends `Error`, calls `Object.setPrototypeOf` (so `instanceof` survives
 * transpilation), and ships a matching `is*` type guard per the project constitution
 * (CODING_STANDARDS §"Custom errors"). DAO errors are internal — services map them to HTTP
 * responses and never leak the message or DB detail to a caller.
 */

import type { FoodStatus } from './food.dao.js';

/** Base class for all food-DAO errors. */
export class FoodDaoError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'FoodDaoError';
        Object.setPrototypeOf(this, FoodDaoError.prototype);
    }
}

/**
 * Type guard for {@link FoodDaoError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is a {@link FoodDaoError}.
 */
export function isFoodDaoError(error: unknown): error is FoodDaoError {
    return error instanceof FoodDaoError;
}

/**
 * Thrown by `FoodDao.setStatus` when the guarded conditional UPDATE matched no row (`rowCount=0`):
 * the requested target status is not reachable from the row's current status under the legal
 * lifecycle transition set (FR-028a), or the food id does not exist. The food's status is left
 * unchanged.
 *
 * ⛔ NEVER give this an arm in `ApiExceptionFilter`. It is raised from several call sites whose HTTP
 * meanings differ — an operator requeue of a healthy food is a `409` the caller can act on, while the same
 * rejection from the merge/persist path behind `PATCH /{id}` is a server-side lifecycle bug that must stay
 * a `500` (and must keep its `error`-level log line, which a 4xx would demote to `warn`). One global
 * mapping would be wrong at all but one site, so each caller translates it at its own boundary.
 */
export class IllegalStatusTransitionError extends FoodDaoError {
    /** The food id whose transition was rejected. */
    public readonly foodId: string;

    /** The target status that was not reachable. */
    public readonly target: FoodStatus;

    public constructor(foodId: string, target: FoodStatus) {
        super(`Illegal status transition to '${target}' for food '${foodId}'`);
        this.name = 'IllegalStatusTransitionError';
        this.foodId = foodId;
        this.target = target;
        Object.setPrototypeOf(this, IllegalStatusTransitionError.prototype);
    }
}

/**
 * Type guard for {@link IllegalStatusTransitionError}.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` is an {@link IllegalStatusTransitionError}.
 */
export function isIllegalStatusTransitionError(error: unknown): error is IllegalStatusTransitionError {
    return error instanceof IllegalStatusTransitionError;
}

/** Postgres `unique_violation` SQLSTATE (a duplicate-key race). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Type guard for a Postgres unique-violation error (SQLSTATE `23505`), used to recover from a
 * lost insert race by re-selecting the existing row.
 *
 * @param error - The thrown value.
 * @returns `true` when `error` carries the `23505` SQLSTATE `code`.
 */
export function isUniqueViolation(error: unknown): error is { code: string } {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === PG_UNIQUE_VIOLATION
    );
}
