/**
 * Domain errors for the `/api/v1/foods/*` API. Transport-agnostic: `FoodsService` throws these and
 * `FoodsController` maps each to an HTTP status (FR-051 precedence). Every error extends `Error`,
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

/**
 * A query too short to be honoured — below 003-FR-010a's search minimum — on the ON-DEMAND live search
 * (plan U29). Maps to `400 VALIDATION_FAILED`, naming the field and the floor.
 *
 * ⛔ The LOCAL `GET /api/v1/foods/search` deliberately does NOT do this: it short-circuits a short query to
 * an empty page, which costs nothing. The live route must refuse instead, for two reasons. It spends a call
 * against a SHARED 1,000/hr external quota, so a request that cannot be honoured must not be allowed to
 * consume one. And an empty page there would be indistinguishable from "the source has nothing for this",
 * which is the one outcome that surface exists to report — collapsing them tells a cook to stop looking for
 * a food the source was never asked about.
 *
 * ⚠️ The rule lives in the SERVICE, not in the query schema, because the food contract's import allowlist is
 * zod-only on purpose: `@kitchensink/recipe-core` is a RECIPE domain package, and the one-directional rule
 * (feature 001 T150) forbids the ingredient contract from depending on it. So the wire schema constrains the
 * SHAPE and the service applies the DOMAIN rule — reading the same `meetsSearchMinimum` the DAO, the local
 * search and both clients read, so there is still exactly one authority for the number.
 */
export class SearchQueryTooShortError extends Error {
    /** The minimum character count, reported so a client need not restate it to explain the refusal. */
    public readonly minimum: number;

    public constructor(minimum: number, message = 'The search query is shorter than the minimum') {
        super(message);
        this.name = 'SearchQueryTooShortError';
        this.minimum = minimum;
        Object.setPrototypeOf(this, SearchQueryTooShortError.prototype);
    }
}

/** Type guard for {@link SearchQueryTooShortError}. */
export function isSearchQueryTooShortError(error: unknown): error is SearchQueryTooShortError {
    return error instanceof SearchQueryTooShortError;
}

/**
 * The upstream source did not answer — a transport failure, a timeout, or a source `5xx` — on a path a
 * user is WAITING on (the on-demand live search, plan U29). Maps to `502 Bad Gateway`: the fault is
 * upstream rather than ours, and it carries no `Retry-After`, because we know nothing about when the
 * source will recover.
 *
 * ⛔ The distinction from its two neighbours is load-bearing at the picker, not merely tidy. A cook must
 * be able to tell "the source has nothing for this" (an empty `200`) from "the source is busy, try again
 * shortly" ({@link FetchUnavailableError}, `503` + `Retry-After`) from "the source did not answer"
 * (this). The first means stop looking; the other two mean try again — and only one of them is our own
 * rate limit. Collapsing any pair strands a cook in the wrong loop.
 *
 * ⚠️ A source `429` is deliberately NOT this: it is our budget meeting the source's, so it raises
 * {@link FetchUnavailableError} and trips the limiter's 429 failsafe (FR-026).
 */
export class SourceUnavailableError extends Error {
    /** The source that failed — named for the log, never for the sanitized wire body (FR-ADP-1). */
    public readonly source: string;

    public constructor(source: string, message = 'The food data source is unavailable') {
        super(message);
        this.name = 'SourceUnavailableError';
        this.source = source;
        Object.setPrototypeOf(this, SourceUnavailableError.prototype);
    }
}

/** Type guard for {@link SourceUnavailableError}. */
export function isSourceUnavailableError(error: unknown): error is SourceUnavailableError {
    return error instanceof SourceUnavailableError;
}

/**
 * An edit/delete was attempted on a PIPELINE food → `409 NOT_EDITABLE` (plan U10, D8).
 *
 * A 409 rather than a 403 ON PURPOSE: the refusal is about the RESOURCE's nature (catalog rows have a
 * single writer — the USDA merge engine), not the caller's identity. Every caller gets the same answer.
 */
export class NotEditableError extends Error {
    /** The pipeline food's id. */
    public readonly id: string;

    public constructor(id: string) {
        super(`Food '${id}' is catalog data and cannot be edited`);
        this.name = 'NotEditableError';
        this.id = id;
        Object.setPrototypeOf(this, NotEditableError.prototype);
    }
}

/** Type guard for {@link NotEditableError}. */
export function isNotEditableError(error: unknown): error is NotEditableError {
    return error instanceof NotEditableError;
}

/**
 * The caller already authored a food with this normalized name → `409 DUPLICATE_AUTHORED_NAME` (plan U10,
 * KTD-H's per-author partial unique surfacing as a domain answer instead of a bare 23505).
 */
export class DuplicateAuthoredNameError extends Error {
    /** The already-authored food the name collides with. */
    public readonly existingId: string;

    public constructor(existingId: string) {
        super('You already authored a food with this name');
        this.name = 'DuplicateAuthoredNameError';
        this.existingId = existingId;
        Object.setPrototypeOf(this, DuplicateAuthoredNameError.prototype);
    }
}

/** Type guard for {@link DuplicateAuthoredNameError}. */
export function isDuplicateAuthoredNameError(error: unknown): error is DuplicateAuthoredNameError {
    return error instanceof DuplicateAuthoredNameError;
}

/**
 * A stranger's write on a PROMOTED authored food → `403 FORBIDDEN` (plan U10 — existence is public after
 * promotion, so unlike the private case the honest refusal names the reason rather than hiding the row).
 */
export class NotFoodAuthorError extends Error {
    /** The food's id. */
    public readonly id: string;

    public constructor(id: string) {
        super(`Food '${id}' can only be edited by its author`);
        this.name = 'NotFoodAuthorError';
        this.id = id;
        Object.setPrototypeOf(this, NotFoodAuthorError.prototype);
    }
}

/** Type guard for {@link NotFoodAuthorError}. */
export function isNotFoodAuthorError(error: unknown): error is NotFoodAuthorError {
    return error instanceof NotFoodAuthorError;
}
