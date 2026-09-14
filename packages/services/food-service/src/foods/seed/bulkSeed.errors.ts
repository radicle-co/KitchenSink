/**
 * Errors raised by the bulk-seed importer (ingredient-search plan §2 Stage 1).
 *
 * The importer's failure policy is deliberate: ONE bad row must not abort an 8k-row import (a re-run is
 * idempotent, so the row is simply retried next time), but SYSTEMIC breakage — a missing migration, a
 * revoked grant, an exhausted connection pool — must not be ground through 8,000 times and reported as
 * "completed with 8,000 failures". {@link BulkSeedAbortedError} is the circuit breaker between those two
 * cases: it fires when failures come CONSECUTIVELY, which is the signal that the problem is the
 * environment rather than the data.
 */

/** Thrown when consecutive per-food failures hit the configured cap — the run is aborted, not completed. */
export class BulkSeedAbortedError extends Error {
    /** How many consecutive failures triggered the abort. */
    public readonly consecutiveFailures: number;
    /** Candidates consumed before the abort (a re-run resumes from the already-seeded prefix). */
    public readonly processed: number;

    /**
     * @param consecutiveFailures - The consecutive-failure count that tripped the breaker.
     * @param processed - How many candidates had been consumed when it tripped.
     * @param cause - The last underlying failure.
     */
    public constructor(consecutiveFailures: number, processed: number, cause?: unknown) {
        super(
            `Bulk seed aborted after ${consecutiveFailures} consecutive failures (${processed} candidates processed) — ` +
                'this looks systemic rather than data-specific; fix the cause and re-run (the import is idempotent).',
            cause === undefined ? undefined : { cause },
        );
        this.name = 'BulkSeedAbortedError';
        this.consecutiveFailures = consecutiveFailures;
        this.processed = processed;
        Object.setPrototypeOf(this, BulkSeedAbortedError.prototype);
    }
}

/**
 * Type guard for {@link BulkSeedAbortedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a bulk-seed abort.
 */
export function isBulkSeedAbortedError(error: unknown): error is BulkSeedAbortedError {
    return error instanceof BulkSeedAbortedError;
}
