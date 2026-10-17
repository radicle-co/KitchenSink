/**
 * @module @commise/features-account/paidFeatures — the ONE place a profile read becomes what every paid-feature
 * surface renders from (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D13).
 *
 * Owner ruling 2026-10-13: every upsell and paid feature sits behind a gate, and the apps render them from identity's
 * `account.paidFeatures` alone — `granted` (use them), `upsell` (offer Premium), `hidden` (show neither). Identity
 * derives it from the verified roles and the stage's gate; the services enforce every paid write from roles.
 *
 * ⛔ A FAILED READ IS `hidden`, never `upsell` or `granted`: the client does not know what to show, so it shows no paid
 * feature and no upsell. A read still PENDING is `loading`, which every surface also treats as fail-closed — it never
 * offers what it might have to take back. A cached answer survives a failed background refetch.
 *
 * ⛔ THAT FALLBACK IS FOR DISPLAY. A write decided from a failed read would treat "the client does not know" as "the
 * server said no" — it withheld an entitled cook's Private and published the recipe. What a write may rely on is
 * {@link knownPaidFeaturesOf}: the profile's answer, or nothing.
 *
 * @pattern Adapter — a profile query's state to the surfaces' paid-feature state
 */
import type { PaidFeatures, UserProfile } from '@kitchensink/schema-identity';

/** What the paid-feature surfaces know: the profile's answer, or `loading` until there is one. */
export type PaidFeatureState = 'loading' | PaidFeatures;

/** The slice of a profile query this reads (TanStack Query's `status` and `data`). */
export interface ProfileQueryState {
    readonly status: 'pending' | 'error' | 'success';
    readonly data: UserProfile | undefined;
}

/**
 * The paid-feature state for a profile query. Pure.
 *
 * @param query - The viewer's profile query.
 * @returns The profile's answer when there is one; `hidden` for a read that failed; otherwise `loading`.
 */
export function paidFeatureStateOf(query: ProfileQueryState): PaidFeatureState {
    if (query.data !== undefined) {
        return query.data.account.paidFeatures;
    }

    return query.status === 'error' ? 'hidden' : 'loading';
}

/**
 * The profile's answer, for a decision about what to WRITE. Pure.
 *
 * @param query - The viewer's profile query.
 * @returns The profile's `paidFeatures` when there is one (a failed refetch keeps it); otherwise `undefined` — unknown,
 *   never `hidden`.
 */
export function knownPaidFeaturesOf(query: ProfileQueryState): PaidFeatures | undefined {
    return query.data?.account.paidFeatures;
}
