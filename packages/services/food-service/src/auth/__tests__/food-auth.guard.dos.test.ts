/**
 * Unit tests for {@link FoodAuthGuard}'s auth-layer DoS protection (T-054, FR-052/SC-009/SC-011). The
 * `@kitchensink/clerk-verify` verifier is mocked and COUNTED so the suite proves load is shed BEFORE the
 * CPU-bound signature check: once a source crosses the per-source `401`-rate cap, further requests from
 * it are shed with `503` WITHOUT invoking the verifier, while a different source is unaffected; and a
 * saturated verification-concurrency pool sheds with `503` too.
 */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async () => {
    const actual = await vi.importActual<typeof import('@kitchensink/clerk-verify')>('@kitchensink/clerk-verify');

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

import { AuthLoadShedder } from '../auth-load-shedder.js';
import { FoodAuthGuard } from '../food-auth.guard.js';
import type { AuthenticatedRequest } from '../authenticated-principal.js';

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
