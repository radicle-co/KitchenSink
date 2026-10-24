/**
 * The per-user rate limit's KEY (plan 002 S3, R42): who a request counts against.
 *
 * The stock throttler keys on `req.ip`. Behind the shared ALB that is the ALB node's address for every caller, so a
 * "per-user" cap keyed on it would be one counter shared by every cook. These cases pin the key to the verified
 * principal, and pin the fallback to the address the ALB gives, never to a header the caller can write.
 *
 * That two users from one address really get two counters, through the real guard, is
 * `tests/requesterRateLimit.integration.test.ts`.
 *
 * Its refusal is the cook's own limit, so it answers in the same error as the hourly source budget (row editor item
 * 10), carrying the throttler's own block time.
 *
 * @module
 */
import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isRequesterLimitReachedError } from '../../../foods/foods.errors.js';
import { UserThrottlerGuard, throttleTrackerFor } from '../userThrottler.guard.js';

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

describe('UserThrottlerGuard refusal', () => {
    /** A route class with one handler and no throttle metadata, so the module options decide the limit. */
    class Routes {
        public search(): void {}
    }

    const storage = new ThrottlerStorageService();

    afterEach(() => {
        storage.onApplicationShutdown();
    });

    it("refuses past the limit with the requester's limit error, carrying the block's seconds", async () => {
        const guard = new UserThrottlerGuard([{ name: 'default', ttl: 60_000, limit: 1 }], storage, new Reflector());
        const request = { user: { sub: 'user_a' }, ip: '10.0.0.1', headers: {} };
        const context = (): ExecutionContextHost =>
            new ExecutionContextHost([request, { header: vi.fn() }], Routes, Routes.prototype.search);

        await guard.onModuleInit();
        await expect(guard.canActivate(context())).resolves.toBe(true);

        const refusal: unknown = await guard.canActivate(context()).catch((error: unknown) => error);

        expect(isRequesterLimitReachedError(refusal)).toBe(true);
        expect(isRequesterLimitReachedError(refusal) && refusal.retryAfterSeconds).toBe(60);
    });
});
