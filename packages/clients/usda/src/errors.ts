/**
 * Typed error hierarchy for `UsdaApiClient`. Every error extends `Error`, calls
 * `Object.setPrototypeOf` (so `instanceof` survives transpilation), and ships a matching
 * `is*` type guard per the project constitution.
 */
import type { ZodIssue } from 'zod';

/** Base class for all USDA client errors. */
export class UsdaClientError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'UsdaClientError';
        Object.setPrototypeOf(this, UsdaClientError.prototype);
    }
}

/** Type guard for {@link UsdaClientError}. */
export function isUsdaClientError(error: unknown): error is UsdaClientError {
    return error instanceof UsdaClientError;
}

/** Thrown when USDA responds `404` — the food does not exist (tombstone candidate). */
export class UsdaNotFoundError extends UsdaClientError {
    /** The FDC id that was not found. */
    public readonly fdcId: number;

    public constructor(fdcId: number) {
        super(`USDA food ${fdcId} not found`);
        this.name = 'UsdaNotFoundError';
        this.fdcId = fdcId;
        Object.setPrototypeOf(this, UsdaNotFoundError.prototype);
    }
}

/** Type guard for {@link UsdaNotFoundError}. */
export function isUsdaNotFoundError(error: unknown): error is UsdaNotFoundError {
    return error instanceof UsdaNotFoundError;
}

/** Thrown when USDA responds `429` — the upstream rate limit is exhausted. */
export class UsdaRateLimitError extends UsdaClientError {
    public constructor(message = 'USDA rate limit exceeded') {
        super(message);
        this.name = 'UsdaRateLimitError';
        Object.setPrototypeOf(this, UsdaRateLimitError.prototype);
    }
}

/** Type guard for {@link UsdaRateLimitError}. */
export function isUsdaRateLimitError(error: unknown): error is UsdaRateLimitError {
    return error instanceof UsdaRateLimitError;
}

/** Thrown when USDA responds with a `5xx` status. */
export class UsdaServerError extends UsdaClientError {
    /** The upstream HTTP status code (500–599). */
    public readonly status: number;

    public constructor(status: number, message = `USDA server error (${status})`) {
        super(message);
        this.name = 'UsdaServerError';
        this.status = status;
        Object.setPrototypeOf(this, UsdaServerError.prototype);
    }
}

/** Type guard for {@link UsdaServerError}. */
export function isUsdaServerError(error: unknown): error is UsdaServerError {
    return error instanceof UsdaServerError;
}

/** Thrown when a request exceeds the configured (10s) timeout. */
export class UsdaTimeoutError extends UsdaClientError {
    /** The underlying transport error (abort / ECONNRESET / DNS / non-JSON body), when there is one. */
    public override readonly cause: unknown;

    public constructor(message = 'USDA request timed out', cause?: unknown) {
        super(message);
        this.name = 'UsdaTimeoutError';
        this.cause = cause;
        Object.setPrototypeOf(this, UsdaTimeoutError.prototype);
    }
}

/** Type guard for {@link UsdaTimeoutError}. */
export function isUsdaTimeoutError(error: unknown): error is UsdaTimeoutError {
    return error instanceof UsdaTimeoutError;
}

/** Thrown when `getFoodsBatch` is called with more than the 20-id upstream maximum. */
export class InvalidBatchSizeError extends UsdaClientError {
    /** The rejected request size. */
    public readonly size: number;
    /** The maximum number of ids allowed in a single batch. */
    public readonly maxSize: number;

    public constructor(size: number, maxSize: number) {
        super(`USDA batch size ${size} exceeds the maximum of ${maxSize}`);
        this.name = 'InvalidBatchSizeError';
        this.size = size;
        this.maxSize = maxSize;
        Object.setPrototypeOf(this, InvalidBatchSizeError.prototype);
    }
}

/** Type guard for {@link InvalidBatchSizeError}. */
export function isInvalidBatchSizeError(error: unknown): error is InvalidBatchSizeError {
    return error instanceof InvalidBatchSizeError;
}

/**
 * Thrown when USDA returns a `2xx` response whose body fails runtime schema validation —
 * i.e. the upstream shape has drifted from what we model. Distinct from {@link UsdaServerError}
 * (a non-2xx status): here the transport succeeded but the payload is malformed, so callers can
 * alert on shape drift separately from upstream outages.
 */
export class UsdaSchemaError extends UsdaClientError {
    /** The zod validation issues, preserved for debugging/observability. */
    public readonly issues: readonly ZodIssue[];

    /**
     * @param issues - The zod issues from the failed `safeParse`.
     * @param message - Optional override; defaults to a summary of the first issue.
     */
    public constructor(issues: readonly ZodIssue[], message?: string) {
        const first = issues[0];
        const summary =
            first !== undefined
                ? `at ${first.path.join('.') || '<root>'}: ${first.message}`
                : 'unknown validation error';
        super(message ?? `USDA response failed schema validation (${summary})`);
        this.name = 'UsdaSchemaError';
        this.issues = issues;
        Object.setPrototypeOf(this, UsdaSchemaError.prototype);
    }
}

/** Type guard for {@link UsdaSchemaError}. */
export function isUsdaSchemaError(error: unknown): error is UsdaSchemaError {
    return error instanceof UsdaSchemaError;
}
