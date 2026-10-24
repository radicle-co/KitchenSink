/**
 * The lease fence (U5/R16) — the proof a settle carries that it still owns the claim it is settling.
 *
 * ⛔ Why a fence exists at all. `leaseNext` stamps `leased_at` and the reaper reverts a lapsed stamp to
 * `pending`, which is enough to RECOVER a crashed worker's row and not nearly enough to be safe: the
 * worker whose lease lapsed is usually not dead, only slow. It finishes, calls `resolve`, and lands its
 * result on a row a second loop has already claimed — two fetches of the same food, one outcome silently
 * overwriting the other. The lease answers "may I start?"; the fence answers "am I still the one?", and
 * only the second question can be asked at the moment it matters.
 *
 * ⛔ The fence is an OPAQUE STRING, never a `Date`, and that is load-bearing rather than fastidious.
 * Postgres stores `timestamptz` to microseconds; node-postgres parses it into a JS `Date`, which carries
 * milliseconds. A fence that round-trips through `Date` is therefore TRUNCATED — `10:00:00.936` compared
 * against a stored `10:00:00.936103` — and matches nothing. Measured: a `Date` parameter matched 0 rows
 * where the `::text` rendering matched 1. Every settle in production would have thrown, while any test
 * that built its own fence would have passed, because both sides of that comparison are truncated
 * together. The brand is what stops a caller doing date arithmetic on it and reintroducing that.
 */

declare const leaseFenceBrand: unique symbol;

/**
 * The `leased_at` stamp a claim wrote, rendered exactly as Postgres holds it. Opaque by construction —
 * it is a TOKEN that happens to be a timestamp, and nothing may treat it as a time.
 */
export type LeaseFence = string & { readonly [leaseFenceBrand]: 'fetch_queue.leased_at' };

/**
 * What a settle may present as its authority: the fence its claim was given, or the explicit literal for
 * a caller that holds no claim at all (the API's corroboration path, which completes a food out of band).
 *
 * ⛔ The bypass is a VALUE, not an absent argument. A settle with no authority would be reachable by
 * forgetting a parameter; `'out-of-band'` has to be typed, is greppable, and shows at the call site which
 * of the two things is happening.
 */
export type SettleAuthority = LeaseFence | 'out-of-band';

/**
 * Brand a raw `leased_at::text` rendering as a fence.
 *
 * The only production caller is `FetchQueueDao.leaseNext`, which takes the value straight from the
 * claiming statement's `RETURNING` clause — the strongest source available, and specifically not a
 * re-read, which could already describe a different claim. Tests use it to mint a fence no row carries.
 *
 * @param stamp - A `leased_at::text` rendering from Postgres.
 * @returns The same string, branded.
 */
export function leaseFenceFrom(stamp: string): LeaseFence {
    return stamp as LeaseFence;
}

/**
 * Thrown when a fenced settle matched no row: the claim it names has been reaped, reclaimed, or already
 * settled, so its result must NOT be applied.
 *
 * It is thrown rather than returned deliberately. A returned `'lease-lost'` is a value TypeScript lets
 * every one of the consumer's ten settle sites ignore, and the one that got ignored would be the one that
 * mattered; an exception cannot be dropped by omission.
 */
export class LeaseLostError extends Error {
    /**
     * @param foodId - The food whose claim was lost.
     * @param operation - The settle that was refused.
     */
    public constructor(
        public readonly foodId: string,
        public readonly operation: string,
    ) {
        super(`lease lost for food ${foodId}: ${operation} refused — the claim was reaped or reclaimed`);
        this.name = 'LeaseLostError';

        Object.setPrototypeOf(this, LeaseLostError.prototype);
    }
}

/**
 * Type guard for {@link LeaseLostError}.
 *
 * @param error - The thrown value.
 * @returns Whether it is a lost-lease refusal.
 */
export function isLeaseLostError(error: unknown): error is LeaseLostError {
    return error instanceof LeaseLostError;
}
