/**
 * ONE authority for whether a viewer is premium.
 *
 * The system had two, and they disagreed totally rather than occasionally. `recipe-service` gates private
 * recipes on `permissions` from the Clerk-signed token (`PREMIUM_PERMISSION`, the way every other grant in
 * this system works — admin scopes, `recipes:import:public`, ADR-0023's field-level grant). The apps gated
 * the SAME control on `account.subscription_tier`, a column created `'free'` by migration `0005` that
 * NOTHING in the repository ever writes: `updateSubscriptionTier`, `createForUser` and `upsert` have no
 * production callers, the only account insert never sets the field, and no `subscription.*` webhook handler
 * exists to receive one.
 *
 * So the column carried no information, and the consequences were user-visible: no viewer could ever be
 * offered the private option on either platform whatever their real entitlement, while recipe-service would
 * have accepted the write — and the profile screen told a genuinely premium viewer they were free.
 *
 * ⚠️ 005's own dependency graph had already flagged the DB read as a defect rather than a design: "T062
 * reads `accounts.subscription_tier`, owned by another service, with no client path declared… The
 * dependency is real but unrepresentable as a task edge today."
 */
import { describe, expect, it } from 'vitest';

import { PREMIUM_PERMISSION, subscriptionTierFor } from '../domain/subscriptionTier.js';

describe('subscriptionTierFor', () => {
    it('reports premium when the signed token grants it', () => {
        expect(subscriptionTierFor([PREMIUM_PERMISSION])).toBe('premium');
    });

    it('reports free when it does not', () => {
        expect(subscriptionTierFor([])).toBe('free');
        expect(subscriptionTierFor(['admin:users', 'recipes:import:public'])).toBe('free');
    });

    it('reads the grant alongside others rather than requiring it alone', () => {
        expect(subscriptionTierFor(['admin:users', PREMIUM_PERMISSION])).toBe('premium');
    });

    it('is exact — a permission that merely CONTAINS the word does not grant it', () => {
        // A prefix match would make `premium:trial` or `not-premium` an entitlement, which is the class of
        // bug the delimiter-aware `pr-{N}` matcher exists to prevent one system over.
        expect(subscriptionTierFor(['premium:trial'])).toBe('free');
        expect(subscriptionTierFor(['not-premium'])).toBe('free');
    });

    it('spells the grant exactly as recipe-service reads it', () => {
        // ⛔ The two services MUST agree on the literal. recipe-service's `PREMIUM_PERMISSION` is the other
        // half of this contract; a divergence here reinstates the very split this module removes, with the
        // failure showing up as a UI that offers an option the service refuses.
        expect(PREMIUM_PERMISSION).toBe('premium');
    });

    it('treats an absent permissions claim as no entitlement', () => {
        expect(subscriptionTierFor(undefined)).toBe('free');
    });
});
