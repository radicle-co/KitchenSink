/**
 * The two refusals `accountErasureWorker` raises, and their guards.
 *
 * ⚠️ EXTRACTED from the handler on 2026-09-04, not authored here. `MisroutedErasureMessageError` was added
 * when the misrouted-delivery thread was fixed, which made the handler export two classes and tripped
 * `oneFileOneThing` (`CODING_STANDARDS` §1). The handler is the one thing that file does; these are a
 * separate subject, so they moved rather than being exempted.
 *
 * Both follow the repository's custom-error convention: extend `Error`, set `name`, call
 * `Object.setPrototypeOf` (without it `instanceof` is false across a transpilation boundary, which is
 * exactly what the guards below rely on), and ship a matching `is*` predicate.
 */

/**
 * Raised when an SQS body is not a usable erasure instruction. Matching guard:
 * {@link isInvalidErasureMessageError}.
 */
export class InvalidErasureMessageError extends Error {
    constructor(reason: string) {
        super(`account-erasure-worker: invalid erasure message — ${reason}`);
        this.name = 'InvalidErasureMessageError';
        Object.setPrototypeOf(this, InvalidErasureMessageError.prototype);
    }
}

/** Type guard for {@link InvalidErasureMessageError}. */
export const isInvalidErasureMessageError = (error: unknown): error is InvalidErasureMessageError =>
    error instanceof InvalidErasureMessageError;

/**
 * Raised when THIS database holds no `account_erasure_jobs` row, in any status, for the owner a message names
 * — the interlock refusing to erase. Matching guard: {@link isMisroutedErasureMessageError}.
 *
 * ⛔ THROWN, NOT LOGGED-AND-ACKNOWLEDGED. The 2026-07-18 hardening plan said the message "still acks (it is
 * genuinely not this DB's job)", and that is exactly the false success the worker's docstring names as the
 * failure it is designed against: an acknowledged message is never redelivered, never reaches the DLQ, never
 * trips `AccountErasureDlqAlarm` — a LEGAL erasure request lost with no signal anywhere. Whether the cause is
 * a cross-stage misroute, a producer that enqueued before its row committed, or a row an operator deleted,
 * the right outcome is the same: the delivery fails, SQS retries (each retry is one read-only `SELECT`,
 * refused again), and the message drains to the DLQ where a human sees it. The interlock still refuses the
 * DELETE on every attempt; only the acknowledgement changed.
 */
export class MisroutedErasureMessageError extends Error {
    public readonly ownerId: string;

    constructor(ownerId: string) {
        super(
            `account-erasure-worker: no erasure job for owner ${ownerId} in this database — refusing to erase, ` +
                'and failing the delivery so the request is redelivered and surfaced rather than lost',
        );
        this.name = 'MisroutedErasureMessageError';
        this.ownerId = ownerId;
        Object.setPrototypeOf(this, MisroutedErasureMessageError.prototype);
    }
}

/** Type guard for {@link MisroutedErasureMessageError}. */
export const isMisroutedErasureMessageError = (error: unknown): error is MisroutedErasureMessageError =>
    error instanceof MisroutedErasureMessageError;
