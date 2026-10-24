/**
 * HOW THE PARSE QUEUE DELIVERS ONE LINE, in seconds — one authority for two deployables (plan 2026-10-15-011).
 *
 * `recipe-workers`' stack builds the parse handler's timeout and the parse queue's visibility timeout from these
 * numbers, and `recipe-service` reads them to say what a pending line is doing (`lineProgressOf`). Both sides
 * import this module, so a change moves the queue and the reading of it in one commit. An SSM value was the
 * alternative and was refused: it resolves when the READING stack deploys, so it drifts silently in between.
 *
 * @pattern Shared Kernel — the delivery numbers both the worker's infrastructure and the service's read depend on
 */

/** The parse queue's delivery timing. */
export interface ParseLineDelivery {
    /**
     * How long one delivery holds a line: the handler's own timeout, and the claim lease `parseLine.ts` refuses a
     * duplicate inside.
     */
    readonly leaseSeconds: number;
    /** When SQS offers an unfinished message again. Above the lease, so a redelivery never meets a live claim. */
    readonly visibilityTimeoutSeconds: number;
    /**
     * How long a whole paste may go without any of its lines moving before a cook is told it is taking longer than
     * usual. Two re-offers: in a paste being served, the longest quiet gap is one visibility cycle.
     */
    readonly stallSeconds: number;
}

const VISIBILITY_TIMEOUT_SECONDS = 180;

/** The parse queue's delivery timing. */
export const PARSE_LINE_DELIVERY: ParseLineDelivery = Object.freeze({
    leaseSeconds: 150,
    visibilityTimeoutSeconds: VISIBILITY_TIMEOUT_SECONDS,
    stallSeconds: 2 * VISIBILITY_TIMEOUT_SECONDS,
});
