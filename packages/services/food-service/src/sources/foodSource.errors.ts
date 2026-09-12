/**
 * The error taxonomy of the source-adapter boundary (MOD-015 / ARCH-013) — every failure a
 * `FoodSourceAdapter` or the `SourceAdapterRegistry` can raise, in one place because callers
 * discriminate across the whole set in a single `catch` (`docs/CODING_STANDARDS.md` §1, "Error taxonomy").
 *
 * Two are RUNTIME failures the fan-out worker classifies without knowing the source ({@link SourceApiError},
 * {@link AdapterValidationError}); two are BOOT/lookup misconfigurations of the registry
 * ({@link DuplicateSourceError}, {@link UnknownSourceError}). Two belong to the rate-limited transport (ADR-0053):
 * {@link SourceBusyError}, a request refused before it reached the source, and {@link SourceAccountingError}, our own
 * admission or block ledger failing. {@link isSourceAdmissionError} covers both. Each extends `Error`, calls
 * `Object.setPrototypeOf` so `instanceof` survives transpilation, and ships a matching `is*` guard.
 *
 * The transport's errors name a {@link CallableApiSourceId}: a held or file source is never called, and that type
 * already makes asking for one unrepresentable. An adapter's errors name the wired source it adapts.
 *
 * No upstream payload is ever carried across this boundary — the messages are sanitized and
 * source-agnostic (FR-ADP-1).
 */
import type { FoodSourceId } from './foodSourceAdapter.js';
import type { CallableApiSourceId } from './sourceRegister.js';

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

/**
 * Why a request was refused before it reached its source (ADR-0053 §2, §4 and §5).
 *
 * - `ceiling`: the source's shared window holds as many calls as the caller's lane may spend (`sourceCeiling.ts`).
 * - `blocked`: a block written after a 429, a 5xx or a low quota is still live.
 * - `contended`: the admission lock was not taken in time, so nothing was counted.
 * - `requesterLimit`: the cook's own hourly source budget is spent (ADR-0055 point 6). Only the requester admission
 *   of a remote search miss answers it (`RequesterWindowAdmission.ts`); no lane's transport composes that admission.
 */
export type SourceBusyReason = 'ceiling' | 'blocked' | 'contended' | 'requesterLimit';

/**
 * Thrown by the rate-limited transport when it refuses a request without calling the source. It is never a timeout
 * and never a `SourceApiError`: the source said nothing, so a caller maps it to its own busy outcome (ADR-0053 §4).
 */
export class SourceBusyError extends Error {
    /** The source the request was for. */
    public readonly source: CallableApiSourceId;
    /** Why the request was refused. */
    public readonly reason: SourceBusyReason;
    /** The earliest time a retry may be admitted. ISO 8601. */
    public readonly retryAt: string;

    /**
     * @param source - The source the request was for.
     * @param reason - Why the request was refused.
     * @param retryAt - The earliest time a retry may be admitted, ISO 8601.
     */
    public constructor(source: CallableApiSourceId, reason: SourceBusyReason, retryAt: string) {
        super(`Source '${source}' is busy (${reason}) until ${retryAt}`);
        this.name = 'SourceBusyError';
        this.source = source;
        this.reason = reason;
        this.retryAt = retryAt;
        Object.setPrototypeOf(this, SourceBusyError.prototype);
    }
}

/** Type guard for {@link SourceBusyError}. */
export function isSourceBusyError(error: unknown): error is SourceBusyError {
    return error instanceof SourceBusyError;
}

/** Which part of the transport's own accounting failed: admitting the call, or recording the block it earned. */
type SourceAccountingStep = 'admit' | 'record';

/**
 * Thrown by the rate-limited transport when its own admission or block ledger fails, for example because the
 * database is down (ADR-0053 §3 and §5). The failure is ours, not the source's: it is never busy, because nothing
 * says when to retry, and never a `SourceApiError`, because the source did not answer with it.
 *
 * - `admit`: the source was not called.
 * - `record`: the source was called and answered, but the block its answer earned was not written, so the answer is
 *   withheld rather than lose the block silently.
 *
 * The message names only the source and the step. The cause carries the underlying error for our own logs and is
 * never put in a response.
 */
export class SourceAccountingError extends Error {
    /** The source the call was for. */
    public readonly source: CallableApiSourceId;
    /** Which step failed. */
    public readonly step: SourceAccountingStep;
    /** The underlying failure, for our own logs. */
    public override readonly cause: unknown;

    /**
     * @param source - The source the call was for.
     * @param step - Which step failed.
     * @param cause - The underlying failure.
     */
    public constructor(source: CallableApiSourceId, step: SourceAccountingStep, cause: unknown) {
        super(`Could not account for a call to source '${source}' (${step})`);
        this.name = 'SourceAccountingError';
        this.source = source;
        this.step = step;
        this.cause = cause;
        Object.setPrototypeOf(this, SourceAccountingError.prototype);
    }
}

/** Type guard for {@link SourceAccountingError}. */
export function isSourceAccountingError(error: unknown): error is SourceAccountingError {
    return error instanceof SourceAccountingError;
}

/**
 * Whether an error was raised by the rate-limited transport without the source answering with it: a refusal
 * ({@link SourceBusyError}) or our own accounting failure ({@link SourceAccountingError}). A client is given this as
 * its `isCallerError`, so it passes both through unchanged instead of reading them as a source timeout.
 *
 * Phase B's callers then tell the two apart:
 *
 * - Busy (ADR-0053 §4): the remote pick returns 503 until `retryAt`; the worker defers per `fanOutPolicy`; PATCH
 *   resolve waits once when `retryAt` is at most 2 s away, otherwise returns 503; a refresh scan stops.
 * - Accounting: the remote pick returns 503; the worker defers the row without counting an attempt; PATCH resolve
 *   returns 503.
 *
 * @param error - The thrown value.
 * @returns True for a {@link SourceBusyError} or a {@link SourceAccountingError}.
 */
export function isSourceAdmissionError(error: unknown): error is SourceBusyError | SourceAccountingError {
    return isSourceBusyError(error) || isSourceAccountingError(error);
}
