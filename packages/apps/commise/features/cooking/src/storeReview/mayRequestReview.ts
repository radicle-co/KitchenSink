/**
 * @module The store-review rule (FR-036, plan 0011 KTD1): whether the app may call the platform's review API after a
 * finished cook. Pure: the clock and every signal are inputs, so the rule is a table of cases.
 *
 * @pattern Specification — a predicate over plain inputs. Any unknown input refuses, so a broken record, a bad
 * date or a moved clock errs toward not asking, never toward asking early.
 */

/** The per-user device record (plan 0011 KTD2). `lastRequestAt` is an ISO 8601 instant. */
export interface StoreReviewRecord {
    readonly finishes: number;
    readonly lastRequestAt?: string | undefined;
}

/** Everything the rule reads. */
export interface ReviewPolicyInput {
    /** `undefined` means not loaded or corrupt, which is not "never asked". */
    readonly record: StoreReviewRecord | undefined;
    /** The account's `createdAt`, an ISO 8601 instant. */
    readonly accountCreatedAt: string | undefined;
    /** True when a paywall, offer or permission sheet already showed this app session (`anyShown()`). */
    readonly interrupted: boolean;
    /** Milliseconds until the soonest running timer is due, read at the mark; `undefined` when none runs. */
    readonly soonestRunningMs: number | undefined;
    /** The clock, an ISO 8601 instant, passed in. */
    readonly now: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_FINISHES = 2;
const MIN_ACCOUNT_AGE_MS = 7 * DAY_MS;
const MIN_REQUEST_GAP_MS = 120 * DAY_MS;
/** A running timer due this soon or sooner blocks the ask ("within 30 s" is inclusive). */
const TIMER_BLOCK_MS = 30_000;

/**
 * Decides whether the app may call the store-review API now.
 *
 * @param input - The record, the account date, the interruption flag, the timer distance and the clock.
 * @returns True only when every FR-036 limit is met. Elapsed milliseconds are used, so no calendar or DST rule applies.
 */
export function mayRequestReview(input: ReviewPolicyInput): boolean {
    const { record, accountCreatedAt, interrupted, soonestRunningMs } = input;
    const now = Date.parse(input.now);
    const created = accountCreatedAt === undefined ? Number.NaN : Date.parse(accountCreatedAt);

    if (record === undefined || interrupted || Number.isNaN(now) || Number.isNaN(created)) {
        return false;
    }

    if (!Number.isInteger(record.finishes) || record.finishes < MIN_FINISHES) {
        return false;
    }

    // A date in the future gives a negative elapsed time, which every lower bound below refuses.
    if (now - created < MIN_ACCOUNT_AGE_MS) {
        return false;
    }

    if (record.lastRequestAt !== undefined) {
        const last = Date.parse(record.lastRequestAt);

        if (Number.isNaN(last) || now - last < MIN_REQUEST_GAP_MS) {
            return false;
        }
    }

    if (soonestRunningMs !== undefined) {
        return Number.isFinite(soonestRunningMs) && soonestRunningMs > TIMER_BLOCK_MS;
    }

    return true;
}
