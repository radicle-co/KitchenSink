/**
 * The per-user rate limit's KEY (plan 002 S3, R42): who a request counts against.
 *
 * The stock throttler keys on `req.ip`. Behind the shared ALB that is the ALB node's address for every caller, so a
 * "per-user" cap keyed on it would be one counter shared by every cook. These cases pin the key to the verified
 * principal, and pin the fallback to the address the ALB gives, never to a header the caller can write.
 *
 * That two users from one address really get two counters, through the real guard, is
 * `tests/liveSearchRateLimit.integration.test.ts`.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { throttleTrackerFor } from '../userThrottler.guard.js';

describe('throttleTrackerFor', () => {
    it('keys a verified caller on their token subject', () => {
        expect(throttleTrackerFor({ user: { sub: 'user_a' }, ip: '10.0.0.1' })).toBe('principal:user_a');
    });

    it('gives two callers from one address two keys', () => {
        const a = throttleTrackerFor({ user: { sub: 'user_a' }, ip: '10.0.0.1' });
        const b = throttleTrackerFor({ user: { sub: 'user_b' }, ip: '10.0.0.1' });

        expect(a).not.toBe(b);
    });

    it('gives one caller one key from any address', () => {
        expect(throttleTrackerFor({ user: { sub: 'user_a' }, ip: '10.0.0.1' })).toBe(
            throttleTrackerFor({ user: { sub: 'user_a' }, ip: '10.0.0.2' }),
        );
    });

    it('keys a caller whose identity has not synced yet on the subject too, so it is still capped', () => {
        expect(throttleTrackerFor({ user: { sub: 'user_unsynced', userId: undefined }, ip: '10.0.0.1' })).toBe(
            'principal:user_unsynced',
        );
    });

    it('falls back to the address the ALB gives when no principal is attached', () => {
        expect(throttleTrackerFor({ ip: '10.0.0.1' })).toBe('ip:10.0.0.1');
    });

    // ⛔ The bypass the fallback must not open: a caller who writes X-Forwarded-For must not choose their own key.
    it('never reads X-Forwarded-For, which the caller can write', () => {
        expect(throttleTrackerFor({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } })).toBe('ip:10.0.0.1');
    });

    it.each([
        ['an empty subject', { user: { sub: '' }, ip: '10.0.0.1' }],
        ['a subject that is not a string', { user: { sub: 42 }, ip: '10.0.0.1' }],
        ['a principal that is not an object', { user: 'user_a', ip: '10.0.0.1' }],
    ])('does not trust %s as a principal', (_label, request) => {
        expect(throttleTrackerFor(request)).toBe('ip:10.0.0.1');
    });

    it('names a request with neither a principal nor an address, rather than keying on undefined', () => {
        expect(throttleTrackerFor({})).toBe('ip:unknown');
    });

    it('keeps the two namespaces apart, so an address can never collide with a subject', () => {
        expect(throttleTrackerFor({ user: { sub: '10.0.0.1' } })).not.toBe(throttleTrackerFor({ ip: '10.0.0.1' }));
    });
});
