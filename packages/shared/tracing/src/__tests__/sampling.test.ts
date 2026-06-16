import { describe, it, expect } from 'vitest';

import { isForceSampled } from '../sampling.js';

describe('isForceSampled', () => {
    const forced = new Set(['user_admin', 'user_under_investigation']);

    it('force-samples a sub present in the admin-set store', () => {
        expect(isForceSampled('user_admin', forced)).toBe(true);
    });

    it('does NOT force-sample a sub absent from the store (no client-header bypass)', () => {
        expect(isForceSampled('user_random_anon', forced)).toBe(false);
    });

    it('does NOT force-sample when there is no sub', () => {
        expect(isForceSampled(undefined, forced)).toBe(false);
        expect(isForceSampled('', forced)).toBe(false);
    });

    it('never force-samples against an empty store', () => {
        expect(isForceSampled('user_admin', new Set())).toBe(false);
    });
});
