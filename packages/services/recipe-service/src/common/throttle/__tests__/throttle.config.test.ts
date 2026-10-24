import { afterEach, describe, it, expect } from 'vitest';

import {
    DEFAULT_THROTTLER_NAME,
    THROTTLE_WINDOW_MS,
    readLimit,
    throttleLimitFromEnv,
    throttlerModuleOptions,
} from '../throttle.config.js';
import { RATE_LIMIT_DEFAULTS } from '../throttleDefaults.js';

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

    it('registers exactly ONE throttler (categories are per-route @Throttle overrides, not named throttlers)', () => {
        // The defect this guards: v6 applies the AND of every registered throttler to every route, so a
        // second registered throttler would silently cap EVERY route at the most restrictive limit. One
        // throttler makes that class of bug unrepresentable.
        expect(Array.isArray(throttlerModuleOptions)).toBe(true);
        expect(throttlerModuleOptions).toHaveLength(1);
    });

    it("registers the single throttler under the 'default' name so @Throttle({ default }) overrides bind", () => {
        expect(DEFAULT_THROTTLER_NAME).toBe('default');
        expect(throttlerModuleOptions[0]?.name).toBe(DEFAULT_THROTTLER_NAME);
    });

    it('makes the generous read limit the default throttler limit (the common-path / inherited cap)', () => {
        // ⚠️ Asserted against the shared default record, NOT a literal. This line read `toBe(120)` and went
        // stale the moment the limits were re-derived from real flows — a hardcoded copy of a number whose
        // owner is `throttleDefaults.ts`. What the test is FOR is that the registered throttler's limit is
        // the READ budget (not the photo one, the original defect below); pinning the digits added nothing
        // and broke on a change that was correct.
        expect(readLimit).toBe(RATE_LIMIT_DEFAULTS.RATE_LIMIT_READ);
        expect(throttlerModuleOptions[0]).toEqual({
            name: DEFAULT_THROTTLER_NAME,
            ttl: THROTTLE_WINDOW_MS,
            limit: readLimit,
        });
    });

    it('sets the default read limit well above the photo-upload limit (reads must NOT inherit 10/min)', () => {
        // Regression pin for the original defect: reads were effectively capped at the photo limit (10).
        expect(readLimit).toBeGreaterThan(10);
    });
});
