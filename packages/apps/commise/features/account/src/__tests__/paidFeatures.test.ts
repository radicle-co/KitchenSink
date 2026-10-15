/**
 * The ONE place a profile read becomes what the paid-feature surfaces render from (plan 2026-10-14-009 D13).
 *
 * Owner ruling 2026-10-13: the apps render paid features and upsells from `account.paidFeatures` alone. A read that is
 * still pending is `loading`; a read that FAILED is `hidden` — fail closed: no paid feature and no upsell, since the
 * client cannot know what to show. The services still enforce every paid write from roles either way.
 */
import { describe, expect, it } from 'vitest';

import { makeUserProfile, makeUserProfileAccount } from '../__fixtures__/index.js';
import { paidFeatureStateOf } from '../paidFeatures.js';

describe('paidFeatureStateOf', () => {
    it.each(['granted', 'upsell', 'hidden'] as const)('settles on the profile’s %s', (paidFeatures) => {
        const data = makeUserProfile({ account: makeUserProfileAccount({ paidFeatures }) });

        expect(paidFeatureStateOf({ status: 'success', data })).toBe(paidFeatures);
    });

    it('is loading while the read is pending', () => {
        expect(paidFeatureStateOf({ status: 'pending', data: undefined })).toBe('loading');
    });

    it('fails CLOSED to hidden when the read failed', () => {
        expect(paidFeatureStateOf({ status: 'error', data: undefined })).toBe('hidden');
    });

    /** A background refetch that failed still holds the last good answer; that answer stands. */
    it('keeps the cached answer when a refetch fails', () => {
        const data = makeUserProfile({ account: makeUserProfileAccount({ paidFeatures: 'granted' }) });

        expect(paidFeatureStateOf({ status: 'error', data })).toBe('granted');
    });

    it('defaults its fixture to hidden — the state of a default user with the gate off', () => {
        expect(makeUserProfileAccount().paidFeatures).toBe('hidden');
    });
});
