/**
 * Reading a publisher's own quota count from the header names its register declaration states (ADR-0053 §5, plan
 * U26: USDA's `X-RateLimit-Remaining` is the only count that sees the key's other users). A header that is absent or
 * not a non-negative whole number is reported as absent, never as 0, which would read as an exhausted quota and
 * block the source.
 */
import { describe, expect, it } from 'vitest';

import { readQuota } from '../quotaHeaders.js';

const USDA_NAMES = { remainingHeader: 'X-RateLimit-Remaining', limitHeader: 'X-RateLimit-Limit' } as const;

describe('readQuota', () => {
    it('reads both counts from the declared header names', () => {
        const headers = new Headers({ 'x-ratelimit-remaining': '742', 'x-ratelimit-limit': '1000' });

        expect(readQuota(headers, USDA_NAMES)).toEqual({ remaining: 742, limit: 1000 });
    });

    it('reads the names the declaration gives, not a fixed pair', () => {
        const headers = new Headers({ 'ratelimit-remaining': '3', 'x-ratelimit-remaining': '742' });

        expect(readQuota(headers, { remainingHeader: 'RateLimit-Remaining', limitHeader: 'RateLimit-Limit' })).toEqual({
            remaining: 3,
        });
    });

    it('reads one count when only one is sent', () => {
        expect(readQuota(new Headers({ 'x-ratelimit-remaining': '0' }), USDA_NAMES)).toEqual({ remaining: 0 });
        expect(readQuota(new Headers({ 'x-ratelimit-limit': '1000' }), USDA_NAMES)).toEqual({ limit: 1000 });
    });

    it('reads nothing when neither header is sent', () => {
        expect(readQuota(new Headers(), USDA_NAMES)).toBeUndefined();
    });

    it.each(['', ' ', '-1', '1.5', '1e3', '0x10', 'many', '12 13'])('reads %j as absent, never as a count', (value) => {
        const headers = { get: (name: string) => (name === 'X-RateLimit-Remaining' ? value : '1000') };

        expect(readQuota(headers, USDA_NAMES)).toEqual({ limit: 1000 });
    });

    it('ignores whitespace around a count', () => {
        const headers = { get: (name: string) => (name === 'X-RateLimit-Remaining' ? ' 42 ' : null) };

        expect(readQuota(headers, USDA_NAMES)).toEqual({ remaining: 42 });
    });
});
