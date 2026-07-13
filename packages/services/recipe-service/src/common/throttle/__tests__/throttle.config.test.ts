import { afterEach, describe, it, expect } from 'vitest';

import {
    THROTTLE_WINDOW_MS,
    ThrottleGroup,
    photoThrottle,
    searchThrottle,
    throttleGroups,
    throttleLimitFromEnv,
    writeThrottle,
} from '../throttle.config.js';

describe('throttleLimitFromEnv', () => {
    afterEach(() => {
        delete process.env['RATE_LIMIT_TEST'];
    });

    it('returns the fallback when the env var is unset', () => {
        expect(throttleLimitFromEnv('RATE_LIMIT_TEST', 30)).toBe(30);
    });

    it('returns a valid positive-integer override', () => {
        process.env['RATE_LIMIT_TEST'] = '100000';
        expect(throttleLimitFromEnv('RATE_LIMIT_TEST', 30)).toBe(100000);
    });

    it('falls back on blank, non-integer, zero, or negative values (never disables throttling)', () => {
        for (const bad of ['', '   ', 'abc', '0', '-5', '3.5']) {
            process.env['RATE_LIMIT_TEST'] = bad;
            expect(throttleLimitFromEnv('RATE_LIMIT_TEST', 30)).toBe(30);
        }
    });
});

describe('throttle configuration', () => {
    it('uses a one-minute window expressed in milliseconds', () => {
        expect(THROTTLE_WINDOW_MS).toBe(60_000);
    });

    it('limits write endpoints to 30 requests per minute', () => {
        expect(writeThrottle).toEqual({ name: ThrottleGroup.WRITES, limit: 30, ttl: 60_000 });
    });

    it('limits photo-upload endpoints to 10 requests per minute', () => {
        expect(photoThrottle).toEqual({ name: ThrottleGroup.PHOTOS, limit: 10, ttl: 60_000 });
    });

    it('limits search endpoints to 60 requests per minute', () => {
        expect(searchThrottle).toEqual({ name: ThrottleGroup.SEARCH, limit: 60, ttl: 60_000 });
    });

    it('exposes every group in a single array for ThrottlerModule registration', () => {
        expect(throttleGroups).toEqual([writeThrottle, photoThrottle, searchThrottle]);
    });

    it('has a unique name per group', () => {
        const names = throttleGroups.map((group) => group.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('shares the one-minute window across every group', () => {
        for (const group of throttleGroups) {
            expect(group.ttl).toBe(THROTTLE_WINDOW_MS);
        }
    });
});
