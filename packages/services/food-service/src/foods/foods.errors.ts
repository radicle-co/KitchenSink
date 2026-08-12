/**
 * Domain errors for the `/api/v1/foods/*` API. Transport-agnostic: {@link FoodsService} throws these and
 * {@link FoodsController} maps each to an HTTP status (FR-051 precedence). Every error extends `Error`,
 * calls `Object.setPrototypeOf`, and ships an `is*` guard (CODING_STANDARDS). No DB/source detail is
 * carried into a message that reaches a caller.
 */
import type { FoodStatus } from './dao/index.js';
import type { PendingFoodStatus, TerminalFoodStatus } from './foods.schema.js';

/**
 * The human-readable explanation for a terminal food, keyed by which terminal state it is in.
 *
 * ⚠️ IT LIVES ON THE ERROR, not in the controller, and that placement is the point. `FoodsController` used to
 * build this prose while mapping the error to a `NotFoundException` — so the error knew its status and the
 * controller knew what that status MEANT, in two files. When the controller's mapping was deleted (the exception
 * filter already owned the identical code→status table), prose held only there would have been lost. The error
 * that knows the fact now carries the sentence about it.
 */
const TERMINAL_EXPLANATION: Readonly<Record<TerminalFoodStatus, string>> = {
    NOT_FOUND: 'No source has this food; tombstoned until TTL (default 30 days)',
    FAILED: 'All sources errored after retries; try again later',
};

/** The food is being fetched / awaiting disambiguation → `202` (`PENDING`/`UNRESOLVED`, FR-003). */
export class FoodPendingError extends Error {
    /** The internal food id. */
    public readonly id: string;
    /**
     * The non-terminal status.
     *
     * Typed {@link PendingFoodStatus}, not the full lifecycle: a `202` cannot carry `RESOLVED` (a `200`) or a
     * terminal status (a `404`), and the sole construction site already narrows to these two. Widening it here
     * would let the type system admit a body the published `pendingResponseSchema` rejects.
     */
    public readonly status: PendingFoodStatus;
    /** Estimated seconds until availability (omitted for `UNRESOLVED`). */
    public readonly estimatedWaitSeconds?: number;

    public constructor(id: string, status: PendingFoodStatus, estimatedWaitSeconds?: number) {
        super(`Food '${id}' is ${status}`);
        this.name = 'FoodPendingError';
        this.id = id;
        this.status = status;
        this.estimatedWaitSeconds = estimatedWaitSeconds;
        Object.setPrototypeOf(this, FoodPendingError.prototype);
    }
}

/** Type guard for {@link FoodPendingError}. */
export function isFoodPendingError(error: unknown): error is FoodPendingError {
    return error instanceof FoodPendingError;
}

/** The food is absent, `NOT_FOUND`, or `FAILED` → `404` (status still retrievable, FR-004). */
export class FoodNotFoundError extends Error {
    /** The internal food id. */
    public readonly id: string;
    /**
     * The terminal status when a row exists, else `undefined` (no row at all).
     *
     * Typed {@link TerminalFoodStatus}: a `404` is only ever answered for a food that is absent, tombstoned or
     * exhausted. `PENDING`/`UNRESOLVED` are a `202` and `RESOLVED` is a `200`.
     */
    public readonly status?: TerminalFoodStatus;

    public constructor(id: string, status?: TerminalFoodStatus) {
        // The message is what the `404` body's `message` shows a caller, so it explains the terminal state
        // rather than restating the status code.
        super(status === undefined ? `Food '${id}' not found` : TERMINAL_EXPLANATION[status]);
        this.name = 'FoodNotFoundError';
        this.id = id;
        this.status = status;
        Object.setPrototypeOf(this, FoodNotFoundError.prototype);
    }
}

/** Type guard for {@link FoodNotFoundError}. */
export function isFoodNotFoundError(error: unknown): error is FoodNotFoundError {
    return error instanceof FoodNotFoundError;
}

/** A PATCH-resolve pick is not in the food's candidate set → `409` (status unchanged, FR-RES-2/DSN-14). */
export class CandidateMismatchError extends Error {
    /** The internal food id. */
    public readonly id: string;

    public constructor(id: string) {
        super(`A picked candidate is not in food '${id}' candidate set`);
        this.name = 'CandidateMismatchError';
        this.id = id;
        Object.setPrototypeOf(this, CandidateMismatchError.prototype);
    }
}

/** Type guard for {@link CandidateMismatchError}. */
export function isCandidateMismatchError(error: unknown): error is CandidateMismatchError {
    return error instanceof CandidateMismatchError;
}

/** A PATCH-resolve was attempted on a non-`UNRESOLVED`, non-`RESOLVED` food → `409` (FR-028a). */
export class NotResolvableError extends Error {
    /** The internal food id. */
    public readonly id: string;
    /** The food's current (non-resolvable) status. */
    public readonly status: FoodStatus;

    public constructor(id: string, status: FoodStatus) {
        super(`Food '${id}' is ${status}, not UNRESOLVED`);
        this.name = 'NotResolvableError';
        this.id = id;
        this.status = status;
        Object.setPrototypeOf(this, NotResolvableError.prototype);
    }
}

/** Type guard for {@link NotResolvableError}. */
export function isNotResolvableError(error: unknown): error is NotResolvableError {
    return error instanceof NotResolvableError;
}

/**
 * Fetch work is temporarily unavailable → `503` + `Retry-After` (FR-046/FR-043b): queue backpressure,
 * a near-ceiling flood-shed of a heavy `sub`'s NEW enqueue, or a resolve hitting the hard rolling-window
 * cap / a re-fetch source failure. NEVER raised for a read or as a per-`sub` `429` quota rejection.
 */
export class FetchUnavailableError extends Error {
    /** Seconds the caller should wait before retrying. */
    public readonly retryAfterSeconds: number;

    public constructor(retryAfterSeconds: number, message = 'Fetch temporarily unavailable') {
        super(message);
        this.name = 'FetchUnavailableError';
        this.retryAfterSeconds = retryAfterSeconds;
        Object.setPrototypeOf(this, FetchUnavailableError.prototype);
    }
}

/** Type guard for {@link FetchUnavailableError}. */
export function isFetchUnavailableError(error: unknown): error is FetchUnavailableError {
    return error instanceof FetchUnavailableError;
}
