/**
 * THE SPEND CEILING'S DENIAL AS AN ERROR — the out-of-band channel from the gated spine to the handler that classifies it
 * (ADR-0024 §3, ADR-0026 §3 as amended; owner ruling 2026-10-26).
 *
 * DESIGN PATTERN: the repository's **typed-error convention** (`extend Error`, `Object.setPrototypeOf`, a matching `is*`
 * guard), the same escape hatch `residencyRefused.ts` uses and for the same reason: `gatedConverse` is four call sites
 * deep behind ports whose return types cannot say "no call was made".
 *
 * ## ⛔ WHY IT IS AN ERROR AND NOT ABSENCE, EVEN THOUGH THE HANDLER LANDS IT
 *
 * `processParseLine` treats an engine that RETURNS absence as a deterministic per-line fact and an engine that THROWS as an
 * outage. A ceiling denial is the second kind everywhere except ONE path: a parse-job line (paste or bulk import), where
 * the owner ruled that a retry only holds the cook's screen until the month ends, so the line lands the CRF reading alone
 * (`single-engine`). Keeping it a thrown, TYPED error means the default stays "transient", the handler opts the one path
 * out BY NAME, and a future caller of `gatedConverse` that forgets the exception retries instead of silently landing.
 *
 * Only a denial is this type. An UNREADABLE counter (`SpendLedgerError`) is a different failure and stays transient on
 * every path: with no counter there is no proof the ceiling holds, so the call fails closed and retries.
 */

/** A Bedrock call that was never made because the one monthly ceiling refused its reservation. */
export class SpendCeilingDeniedError extends Error {
    /** The spend period (`YYYY-MM`) the reserve captured. */
    public readonly period: string;

    /**
     * @param callSite - Which gated leg was refused (attribution only).
     * @param period - The period the denial was captured in.
     */
    public constructor(callSite: string, period: string) {
        super(`${callSite} ceiling reached for ${period}; the call was not made`);
        this.name = 'SpendCeilingDeniedError';
        this.period = period;
        Object.setPrototypeOf(this, SpendCeilingDeniedError.prototype);
    }
}

/**
 * Whether an unknown value is a {@link SpendCeilingDeniedError}.
 *
 * @param error - Any caught value.
 * @returns Whether it is a ceiling denial. Pure.
 */
export function isSpendCeilingDeniedError(error: unknown): error is SpendCeilingDeniedError {
    return error instanceof SpendCeilingDeniedError;
}
