/**
 * The error taxonomy of the source-adapter boundary (MOD-015 / ARCH-013) — every failure a
 * `FoodSourceAdapter` or the `SourceAdapterRegistry` can raise, in one place because callers
 * discriminate across the whole set in a single `catch` (`docs/CODING_STANDARDS.md` §1, "Error taxonomy").
 *
 * Two are RUNTIME failures the fan-out worker classifies without knowing the source ({@link SourceApiError},
 * {@link AdapterValidationError}); two are BOOT/lookup misconfigurations of the registry
 * ({@link DuplicateSourceError}, {@link UnknownSourceError}). Each extends `Error`, calls
 * `Object.setPrototypeOf` so `instanceof` survives transpilation, and ships a matching `is*` guard.
 *
 * No upstream payload is ever carried across this boundary — the messages are sanitized and
 * source-agnostic (FR-ADP-1).
 */
import type { FoodSourceId } from './foodSourceAdapter.js';

/**
 * Thrown when a source's API call fails in a transport/HTTP sense (the source-agnostic classification
 * of an upstream error). `statusCode` lets the worker decide window-full backoff (429) vs retry (5xx)
 * vs no-contribution (404) without knowing the source. Carries no upstream payload.
 */
export class SourceApiError extends Error {
    /** The source whose call failed. */
    public readonly source: FoodSourceId;
    /** The classified status code (HTTP status, or `0` for a timeout/transport failure). */
    public readonly statusCode: number;

    /**
     * @param source - The failing source.
     * @param statusCode - The classified status code (`0` = timeout/transport).
     * @param message - A sanitized, source-agnostic message (never an upstream body).
     */
    public constructor(source: FoodSourceId, statusCode: number, message: string) {
        super(message);
        this.name = 'SourceApiError';
        this.source = source;
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, SourceApiError.prototype);
    }
}

/** Type guard for {@link SourceApiError}. */
export function isSourceApiError(error: unknown): error is SourceApiError {
    return error instanceof SourceApiError;
}

/**
 * Thrown when a mapped value fails the adapter's validation/sanitization (type/range/length/text):
 * reject-not-store (FR-ADP-2/FR-ADP-3). The candidate is rejected as a whole and never enters the
 * store; the worker drops it (the food may still resolve from other valid candidates).
 */
export class AdapterValidationError extends Error {
    /** The source whose candidate failed validation. */
    public readonly source: FoodSourceId;
    /** The opaque key of the rejected item. */
    public readonly externalKey: string;
    /** The field that failed validation (e.g. `nutrient.amount`, `portion.gramWeight`). */
    public readonly field: string;

    /**
     * @param source - The source.
     * @param externalKey - The rejected item's opaque key.
     * @param field - The offending field.
     * @param message - A sanitized reason.
     */
    public constructor(source: FoodSourceId, externalKey: string, field: string, message: string) {
        super(message);
        this.name = 'AdapterValidationError';
        this.source = source;
        this.externalKey = externalKey;
        this.field = field;
        Object.setPrototypeOf(this, AdapterValidationError.prototype);
    }
}

/** Type guard for {@link AdapterValidationError}. */
export function isAdapterValidationError(error: unknown): error is AdapterValidationError {
    return error instanceof AdapterValidationError;
}

/** Thrown when an adapter is registered for a `source` that already has one (boot misconfiguration). */
export class DuplicateSourceError extends Error {
    /** The duplicated source. */
    public readonly source: FoodSourceId;

    /** @param source - The duplicated source. */
    public constructor(source: FoodSourceId) {
        super(`A source adapter is already registered for '${source}'`);
        this.name = 'DuplicateSourceError';
        this.source = source;
        Object.setPrototypeOf(this, DuplicateSourceError.prototype);
    }
}

/** Type guard for {@link DuplicateSourceError}. */
export function isDuplicateSourceError(error: unknown): error is DuplicateSourceError {
    return error instanceof DuplicateSourceError;
}

/** Thrown when a source is referenced that is not part of `SOURCE_PRIORITY` or not registered. */
export class UnknownSourceError extends Error {
    /** The unknown source. */
    public readonly source: string;

    /** @param source - The unknown source. */
    public constructor(source: string) {
        super(`Unknown source '${source}'`);
        this.name = 'UnknownSourceError';
        this.source = source;
        Object.setPrototypeOf(this, UnknownSourceError.prototype);
    }
}

/** Type guard for {@link UnknownSourceError}. */
export function isUnknownSourceError(error: unknown): error is UnknownSourceError {
    return error instanceof UnknownSourceError;
}
