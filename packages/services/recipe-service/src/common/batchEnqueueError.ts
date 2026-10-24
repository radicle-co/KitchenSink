/**
 * The failure a batch producer port reports when it could not deliver everything it was given.
 *
 * It is DECLARED APART FROM ANY TRANSPORT on purpose. The thrower is `common/sqsBatchQueue.ts`, but the
 * catcher is a domain service (`ParseJobsService`), and a service that imported the SQS adapter to narrow
 * an error would depend on the transport its port exists to hide — so a second adapter behind the same
 * port could not report a failure the caller already knows how to act on.
 *
 * DESIGN PATTERN: the repo's custom-error convention — `Error` subclass, `Object.setPrototypeOf`, and a
 * matching `is*` guard.
 */

/**
 * Thrown when an enqueue could not deliver every message it was handed.
 *
 * ⛔ THE POSITIONS ARE INTO THE CALLER'S OWN LIST, which is the only addressing the caller has: it never
 * saw the batches the messages were chunked into, and a batch entry's `Id` re-bases to `'0'` at every
 * chunk. Reporting anything else would make the report unusable at exactly the moment it matters.
 *
 * ⚠️ It says what was LOST, never what landed. A producer that cannot attribute a failure to specific
 * messages must report all of them — exonerating a message on no evidence strands it with nothing to
 * re-drive it, which is strictly worse than delivering it twice.
 */
export class BatchEnqueueError extends Error {
    /** Positions, ascending, of the messages that were not delivered. Always non-empty in practice. */
    public readonly undeliveredIndexes: readonly number[];

    public constructor(message: string, undeliveredIndexes: readonly number[]) {
        super(message);
        this.name = 'BatchEnqueueError';
        this.undeliveredIndexes = undeliveredIndexes;

        // Restore the prototype chain (transpilation to ES targets breaks `instanceof` otherwise).
        Object.setPrototypeOf(this, BatchEnqueueError.prototype);
    }
}

/** Type guard for {@link BatchEnqueueError} instances. */
export function isBatchEnqueueError(value: unknown): value is BatchEnqueueError {
    return value instanceof BatchEnqueueError;
}
