/**
 * The reclaim could not find the sandbox database or the sandbox NAT, so it cannot tell whether the tier is down.
 *
 * ⛔ This THROWS instead of returning a "failed" result. The reclaim deletes only while the tier is quiescent, and a
 * tier it cannot see is not a quiescent one. A throw reaches the state machine's Catch and its `report` step, which
 * creates a Sentry issue; a returned result would end the run in `Fail` with nobody told, because the sandbox alarm
 * topic has no subscriber.
 */
export class ReclaimTierUnobservableError extends Error {
    public constructor(public readonly missing: readonly ('database' | 'nat')[]) {
        super(`The sandbox ${missing.join(' and ')} could not be found, so the tier cannot be shown to be down.`);
        this.name = 'ReclaimTierUnobservableError';
        Object.setPrototypeOf(this, ReclaimTierUnobservableError.prototype);
    }
}

/** Whether `error` is a {@link ReclaimTierUnobservableError}. Pure. */
export function isReclaimTierUnobservableError(error: unknown): error is ReclaimTierUnobservableError {
    return error instanceof ReclaimTierUnobservableError;
}
