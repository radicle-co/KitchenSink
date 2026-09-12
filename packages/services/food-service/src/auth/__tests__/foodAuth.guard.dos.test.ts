/**
 * Unit tests for {@link FoodAuthGuard}'s auth-layer DoS protection (T-054, FR-052/SC-009/SC-011). The
 * `@kitchensink/clerk-verify` verifier is mocked and COUNTED so the suite proves load is shed BEFORE the
 * CPU-bound signature check: once a source crosses the per-source `401`-rate cap, further requests from
 * it are shed with `503` WITHOUT invoking the verifier, while a different source is unaffected; and a
 * saturated verification-concurrency pool sheds with `503` too.
 */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async () => {
    const actual = await vi.importActual<typeof import('@kitchensink/clerk-verify')>('@kitchensink/clerk-verify');

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

import { AuthLoadShedder } from '../AuthLoadShedder.js';
import { authShedderConfigFromEnv, FoodAuthGuard } from '../foodAuth.guard.js';
import type { AuthenticatedRequest } from '../authenticatedPrincipal.js';

const mockVerify = vi.mocked(verifyClerkToken);

/** Build a request carrying a bearer token and a source IP (via X-Forwarded-For). */
function makeReq(token: string, sourceIp: string): AuthenticatedRequest {
    return {
        headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': sourceIp },
        ip: sourceIp,
    } as unknown as AuthenticatedRequest;
}

beforeEach(() => {
    mockVerify.mockReset();
    process.env['CLERK_JWT_KEY'] = 'PEM';
    process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
});

describe('FoodAuthGuard — per-source 401-rate load-shed (FR-052/SC-011)', () => {
    it('sheds a flooding source with 503 BEFORE verifying once it crosses the cap, isolating other sources', async () => {
        mockVerify.mockRejectedValue(new ClerkVerificationError()); // every token invalid (the flood)
        const shedder = new AuthLoadShedder({ maxConcurrent: 100, shedThreshold: 3, shedWindowMs: 60_000 });
        const guard = new FoodAuthGuard(shedder);
        const next = vi.fn() as unknown as NextFunction;

        // First 3 invalid tokens from the flooder → 401, each forcing a verification.
        for (let i = 0; i < 3; i += 1) {
            await expect(guard.use(makeReq('bad', '9.9.9.9'), {} as Response, next)).rejects.toBeInstanceOf(
                UnauthorizedException,
            );
        }

        expect(mockVerify).toHaveBeenCalledTimes(3);

        // The flooder is now over the cap → further requests are shed with 503 and NOT verified.
        await expect(guard.use(makeReq('bad', '9.9.9.9'), {} as Response, next)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        await expect(guard.use(makeReq('bad', '9.9.9.9'), {} as Response, next)).rejects.toBeInstanceOf(
            ServiceUnavailableException,
        );
        expect(mockVerify).toHaveBeenCalledTimes(3); // verifier was protected — no new calls

        // A different source is unaffected: its valid token still verifies and passes.
        mockVerify.mockResolvedValueOnce({ sub: 'user_ok', scopes: [], permissions: [] });
        const goodReq = makeReq('good', '1.1.1.1');
        await guard.use(goodReq, {} as Response, next);
        expect(goodReq.user?.sub).toBe('user_ok');
        expect(mockVerify).toHaveBeenCalledTimes(4);
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe('FoodAuthGuard — verification-concurrency bound (FR-052)', () => {
    it('sheds with 503 when the verification pool is saturated, without verifying', async () => {
        const shedder = new AuthLoadShedder({ maxConcurrent: 1, shedThreshold: 1000, shedWindowMs: 60_000 });
        shedder.tryAcquire(); // saturate the single slot from outside
        const guard = new FoodAuthGuard(shedder);

        await expect(
            guard.use(makeReq('whatever', '2.2.2.2'), {} as Response, vi.fn() as unknown as NextFunction),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('releases the slot after a verification so capacity recovers', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1', scopes: [], permissions: [] });
        const shedder = new AuthLoadShedder({ maxConcurrent: 1, shedThreshold: 1000, shedWindowMs: 60_000 });
        const guard = new FoodAuthGuard(shedder);

        await guard.use(makeReq('good', '3.3.3.3'), {} as Response, vi.fn() as unknown as NextFunction);
        await guard.use(makeReq('good', '3.3.3.3'), {} as Response, vi.fn() as unknown as NextFunction);

        expect(shedder.inFlight()).toBe(0); // both verifications released their slot
    });
});

/**
 * The shedder's own configuration (FR-052). The guard resolved `FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS` /
 * `FOOD_AUTH_SHED_THRESHOLD` / `FOOD_AUTH_SHED_WINDOW_MS` through a private `numberFromEnv` helper — a
 * second, laxer copy of the reader this package now has exactly one of. It mapped ANY malformed value
 * (and `0`, and a negative) to `undefined`, which silently substitutes the shedder's built-in default, and
 * it accepted fractions the boot-time schema rejects. Silently substituting a default is the wrong answer
 * for THIS control in particular: an operator tightening the shed threshold is responding to an auth flood
 * in progress, and a typo would leave the pre-verification cap wherever it was while the flood continues.
 */
describe('the auth shedder configuration read from the environment', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is entirely undefined when unset, so the shedder applies its own documented defaults', () => {
        vi.stubEnv('FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS', undefined);
        vi.stubEnv('FOOD_AUTH_SHED_THRESHOLD', undefined);
        vi.stubEnv('FOOD_AUTH_SHED_WINDOW_MS', undefined);

        expect(authShedderConfigFromEnv()).toEqual({
            maxConcurrent: undefined,
            shedThreshold: undefined,
            shedWindowMs: undefined,
        });
    });

    it('passes the configured knobs through', () => {
        vi.stubEnv('FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS', '32');
        vi.stubEnv('FOOD_AUTH_SHED_THRESHOLD', '7');
        vi.stubEnv('FOOD_AUTH_SHED_WINDOW_MS', '15000');

        expect(authShedderConfigFromEnv()).toEqual({
            maxConcurrent: 32,
            shedThreshold: 7,
            shedWindowMs: 15_000,
        });
    });

    it.each([
        ['FOOD_AUTH_MAX_CONCURRENT_VERIFICATIONS', 'many'],
        ['FOOD_AUTH_SHED_THRESHOLD', '0'],
        ['FOOD_AUTH_SHED_THRESHOLD', '-1'],
        // A fraction the boot-time schema rejects but the old `Number.isFinite` check waved through.
        ['FOOD_AUTH_SHED_THRESHOLD', '2.5'],
        ['FOOD_AUTH_SHED_WINDOW_MS', ''],
        ['FOOD_AUTH_SHED_WINDOW_MS', 'NaN'],
    ])('throws on %s=%o instead of silently reverting to the built-in default', (name, value) => {
        vi.stubEnv(name, value);

        expect(() => authShedderConfigFromEnv()).toThrow(new RegExp(name));
    });
});
