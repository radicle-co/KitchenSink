/**
 * Unit tests for {@link FoodAuthGuard} — the in-process networkless auth middleware (T-033/T-047).
 *
 * The shared `@kitchensink/clerk-verify` verifier is mocked so the suite proves the guard's wiring:
 * Bearer-only extraction, fail-closed `401` on any verification failure, identity populated from the
 * verified `sub` ONLY (a forged `x-debug-sub`/`x-authorizer-context` is ignored), and `next()` invoked
 * exactly once on success and never on failure (no DB/enqueue/source work past a `401`).
 *
 * Requirement → test mapping:
 * - FR-035/FR-040 → "missing/invalid token → 401, next not called"
 * - FR-038        → "forged x-debug-sub / x-authorizer-context is ignored"
 * - FR-047        → "an azp-allowlisted M2M token is accepted"
 */
import { UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@kitchensink/clerk-verify', async () => {
    const actual = await vi.importActual<typeof import('@kitchensink/clerk-verify')>('@kitchensink/clerk-verify');

    return { ...actual, verifyClerkToken: vi.fn() };
});

import { ClerkVerificationError, verifyClerkToken } from '@kitchensink/clerk-verify';

import { FoodAuthGuard } from '../food-auth.guard.js';
import type { AuthenticatedRequest } from '../authenticated-principal.js';

const mockVerify = vi.mocked(verifyClerkToken);

function makeReq(headers: Record<string, string> = {}): AuthenticatedRequest {
    return {
        headers,
        header: (name: string) => headers[name.toLowerCase()],
    } as unknown as AuthenticatedRequest;
}

beforeEach(() => {
    mockVerify.mockReset();
    process.env['CLERK_JWT_KEY'] = 'PEM';
    process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://app.example.com';
});

describe('FoodAuthGuard', () => {
    it('rejects a request with no Authorization header (401), without calling next or the verifier', async () => {
        const guard = new FoodAuthGuard();
        const next = vi.fn() as unknown as NextFunction;

        await expect(guard.use(makeReq(), {} as Response, next)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(next).not.toHaveBeenCalled();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('rejects a malformed Authorization header (no Bearer) with 401', async () => {
        const guard = new FoodAuthGuard();
        const next = vi.fn() as unknown as NextFunction;

        await expect(guard.use(makeReq({ authorization: 'Basic abc' }), {} as Response, next)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('maps a verification failure to 401 and never calls next', async () => {
        mockVerify.mockRejectedValue(new ClerkVerificationError());
        const guard = new FoodAuthGuard();
        const next = vi.fn() as unknown as NextFunction;

        await expect(guard.use(makeReq({ authorization: 'Bearer bad' }), {} as Response, next)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('sets req.user from the verified sub and calls next once on success', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1', scopes: ['food:admin'], permissions: [] });
        const guard = new FoodAuthGuard();
        const req = makeReq({ authorization: 'Bearer good' });
        const next = vi.fn() as unknown as NextFunction;

        await guard.use(req, {} as Response, next);

        expect(req.user).toEqual({
            sub: 'user_1',
            userId: undefined,
            azp: undefined,
            scopes: ['food:admin'],
            permissions: [],
        });
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('surfaces the app-user ULID (userId, from external_id) onto req.user (CR-002/U1)', async () => {
        const ulid = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
        mockVerify.mockResolvedValue({ sub: 'user_1', userId: ulid, scopes: [], permissions: [] });
        const guard = new FoodAuthGuard();
        const req = makeReq({ authorization: 'Bearer good' });

        await guard.use(req, {} as Response, vi.fn() as unknown as NextFunction);

        expect(req.user?.userId).toBe(ulid);
        expect(req.user?.sub).toBe('user_1');
    });

    it('ignores a forged x-debug-sub / x-authorizer-context and trusts only the verified token', async () => {
        mockVerify.mockResolvedValue({ sub: 'real_sub', scopes: [], permissions: [] });
        const guard = new FoodAuthGuard();
        const req = makeReq({
            authorization: 'Bearer good',
            'x-debug-sub': 'forged_admin',
            'x-authorizer-context': '{"sub":"forged_admin","scopes":["food:admin"]}',
        });

        await guard.use(req, {} as Response, vi.fn() as unknown as NextFunction);

        expect(req.user?.sub).toBe('real_sub');
        expect(req.user?.scopes).toEqual([]);
    });

    it('fails closed with 401 when CLERK_JWT_KEY is absent (the guard forwards the absent key to verify)', async () => {
        // Faithful double: the real verifyClerkToken throws when no jwtKey is configured (see its unit
        // suite). Asserting the guard captures + forwards the absent key, and maps the throw to 401.
        delete process.env['CLERK_JWT_KEY'];
        mockVerify.mockImplementation(async (_token, config) => {
            if (!config.jwtKey) {
                throw new ClerkVerificationError();
            }

            return { sub: 'user_1', scopes: [], permissions: [] };
        });
        const guard = new FoodAuthGuard();
        const next = vi.fn() as unknown as NextFunction;

        await expect(guard.use(makeReq({ authorization: 'Bearer good' }), {} as Response, next)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('accepts an azp-allowlisted M2M token (sets req.user, not 401) (FR-047)', async () => {
        mockVerify.mockResolvedValue({ sub: 'svc_recipe_import', azp: 'svc-client-id', scopes: [], permissions: [] });
        const guard = new FoodAuthGuard();
        const req = makeReq({ authorization: 'Bearer m2m' });
        const next = vi.fn() as unknown as NextFunction;

        await guard.use(req, {} as Response, next);

        expect(req.user?.sub).toBe('svc_recipe_import');
        expect(next).toHaveBeenCalledTimes(1);
    });

    // ── ADR-0001 subdomain-cutover: CLERK_AZP_PREVIEW_MODE threads into the shared resolver ──
    describe('azp preview-mode wiring', () => {
        afterEach(() => {
            delete process.env['CLERK_AZP_PATTERN'];
            delete process.env['CLERK_AZP_PREVIEW_MODE'];
        });

        /** Capture the `authorizedPartyPattern` the guard forwards to the (mocked) shared verifier. */
        async function forwardedPattern(): Promise<RegExp | undefined> {
            let captured: RegExp | undefined;
            mockVerify.mockImplementation(async (_token, config) => {
                captured = (config as { authorizedPartyPattern?: RegExp }).authorizedPartyPattern;

                return { sub: 'u', scopes: [], permissions: [] };
            });
            await new FoodAuthGuard().use(makeReq({ authorization: 'Bearer good' }), {} as Response, vi.fn() as never);

            return captured;
        }

        it('forwards a TRANSITION pattern (apex accepted) when CLERK_AZP_PREVIEW_MODE=transition', async () => {
            delete process.env['CLERK_AUTHORIZED_PARTIES'];
            process.env['CLERK_AZP_PATTERN'] = 'sandbox.commise.app';
            process.env['CLERK_AZP_PREVIEW_MODE'] = 'transition';

            const pattern = await forwardedPattern();

            expect(pattern?.test('https://sandbox.commise.app')).toBe(true);
            expect(pattern?.test('https://pr-9.sandbox.commise.app')).toBe(true);
        });

        it('forwards a STRICT pattern (apex rejected) when CLERK_AZP_PREVIEW_MODE is unset', async () => {
            delete process.env['CLERK_AUTHORIZED_PARTIES'];
            process.env['CLERK_AZP_PATTERN'] = 'sandbox.commise.app';

            const pattern = await forwardedPattern();

            expect(pattern?.test('https://sandbox.commise.app')).toBe(false);
            expect(pattern?.test('https://pr-9.sandbox.commise.app')).toBe(true);
        });
    });
});
