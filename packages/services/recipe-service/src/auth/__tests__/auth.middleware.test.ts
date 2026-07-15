import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';
import type { NextFunction, Response } from 'express';
import type { VerifiedClerkClaims } from '@kitchensink/clerk-verify';

import { AuthMiddleware } from '../auth.middleware.js';
import { ClerkAuthService } from '../clerk-auth.service.js';
import type { AuthenticatedRequest } from '../principal.js';

/**
 * T019-test — the recipe service's Clerk session-token `AuthMiddleware`.
 *
 * The middleware is the **fail-closed enforcement point** for owner identity: it verifies the Bearer
 * session token via {@link ClerkAuthService} and produces the canonical Principal whose `userId` is
 * the **app-user ULID** read from the verified token's `external_id` claim (surfaced by
 * `@kitchensink/clerk-verify` as `userId`). When `userId` is absent it MUST reject with 401 and MUST
 * NOT fall back to the Clerk `sub` (retained for trace/audit only).
 */

/** A fully-populated, verified-claims fixture (owner ULID distinct from the Clerk sub). */
const makeClaims = (overrides: Partial<VerifiedClerkClaims> = {}): VerifiedClerkClaims => ({
    sub: 'user_2clerkSubjectId',
    userId: '01HZY0OWNERULID0000000000',
    azp: 'https://commise.app',
    email: 'cook@commise.app',
    firstName: 'Ada',
    lastName: 'Cook',
    picture: 'https://cdn.commise.app/a.png',
    scopes: [],
    permissions: [],
    ...overrides,
});

interface MockContext {
    readonly req: AuthenticatedRequest;
    readonly next: NextFunction;
    readonly res: Response;
}

const makeContext = (options: { authorization?: string; path?: string } = {}): MockContext => {
    const path = options.path ?? '/recipes';
    const headers: Record<string, string> = {};

    if (options.authorization !== undefined) {
        headers['authorization'] = options.authorization;
    }

    const req = {
        headers,
        path,
        originalUrl: path,
    } as unknown as AuthenticatedRequest;

    return {
        req,
        next: vi.fn() as unknown as NextFunction,
        res: {} as Response,
    };
};

const DEV_ENV_KEYS = ['NODE_ENV', 'RECIPE_DEV_AUTH_USER_ID'] as const;

describe('AuthMiddleware', () => {
    let clerkAuth: ClerkAuthService;
    let verifySpy: ReturnType<typeof vi.spyOn>;
    let middleware: AuthMiddleware;
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of DEV_ENV_KEYS) {
            savedEnv[key] = process.env[key];
        }

        // Default to a deployed (non-dev-bypass) posture for every case unless a test opts in.
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];
        process.env['NODE_ENV'] = 'production';

        clerkAuth = new ClerkAuthService();
        verifySpy = vi.spyOn(clerkAuth, 'verify');
        middleware = new AuthMiddleware(clerkAuth);
    });

    afterEach(() => {
        for (const key of DEV_ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }

        vi.restoreAllMocks();
    });

    it('verifies a valid session token and attaches the canonical Principal (userId from external_id)', async () => {
        const claims = makeClaims();
        verifySpy.mockResolvedValue(claims);
        const { req, res, next } = makeContext({ authorization: 'Bearer good.session.token' });

        await middleware.use(req, res, next);

        expect(verifySpy).toHaveBeenCalledExactlyOnceWith('good.session.token');
        expect(req.principal).toBeDefined();
        // The owner key is the app-user ULID from `external_id` — NOT the Clerk sub.
        expect(req.principal?.userId).toBe('01HZY0OWNERULID0000000000');
        expect(req.principal?.userId).not.toBe(claims.sub);
        // `sub` is retained for trace/audit only.
        expect(req.principal?.sub).toBe('user_2clerkSubjectId');
        expect(req.principal?.scopes).toEqual([]);
        expect(next).toHaveBeenCalledOnce();
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects an expired/invalid token with 401 (verification throws)', async () => {
        verifySpy.mockRejectedValue(new UnauthorizedException());
        const { req, res, next } = makeContext({ authorization: 'Bearer expired.token' });

        await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(req.principal).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a request with no bearer token with 401 (verification never runs)', async () => {
        const { req, res, next } = makeContext();

        await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(verifySpy).not.toHaveBeenCalled();
        expect(req.principal).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('FAILS CLOSED (401) when external_id/userId is absent and NEVER falls back to sub', async () => {
        // The token verifies, but carries no `external_id` — the shared verifier leaves `userId`
        // undefined and delegates the fail-closed decision to this middleware (per-service policy).
        const claims = makeClaims({ userId: undefined, sub: 'user_shouldNeverBecomeOwner' });
        verifySpy.mockResolvedValue(claims);
        const { req, res, next } = makeContext({ authorization: 'Bearer no.external.id' });

        const error = await middleware.use(req, res, next).then(
            () => undefined,
            (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(UnauthorizedException);
        // Distinguishable 401: carries `code: IDENTITY_SYNC_PENDING` (the first-token sync race) so the
        // client can refresh the token + retry rather than treat it as a hard auth failure.
        expect((error as UnauthorizedException).getResponse()).toMatchObject({ code: IDENTITY_SYNC_PENDING_CODE });
        // No Principal is produced at all — the Clerk `sub` is NEVER promoted to an owner key.
        expect(req.principal).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('skips authentication for the public /health path', async () => {
        const { req, res, next } = makeContext({ path: '/health' });

        await middleware.use(req, res, next);

        expect(verifySpy).not.toHaveBeenCalled();
        expect(req.principal).toBeUndefined();
        expect(next).toHaveBeenCalledOnce();
    });

    it('skips authentication for the public /health/ready readiness probe', async () => {
        const { req, res, next } = makeContext({ path: '/health/ready' });

        await middleware.use(req, res, next);

        expect(verifySpy).not.toHaveBeenCalled();
        expect(req.principal).toBeUndefined();
        expect(next).toHaveBeenCalledOnce();
    });

    describe('dev bypass', () => {
        it('injects a dev Principal from RECIPE_DEV_AUTH_USER_ID outside production (no token, no verify)', async () => {
            process.env['NODE_ENV'] = 'development';
            process.env['RECIPE_DEV_AUTH_USER_ID'] = '01HZZDEVBYPASSULID00000000';
            const { req, res, next } = makeContext();

            await middleware.use(req, res, next);

            expect(verifySpy).not.toHaveBeenCalled();
            expect(req.principal?.userId).toBe('01HZZDEVBYPASSULID00000000');
            // Even the bypass never conflates userId with sub — sub is a synthetic trace marker.
            expect(req.principal?.userId).not.toBe(req.principal?.sub);
            expect(next).toHaveBeenCalledOnce();
        });

        it('IGNORES the dev bypass in production (still requires a real token → 401)', async () => {
            process.env['NODE_ENV'] = 'production';
            process.env['RECIPE_DEV_AUTH_USER_ID'] = '01HZZDEVBYPASSULID00000000';
            const { req, res, next } = makeContext();

            await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(UnauthorizedException);
            expect(verifySpy).not.toHaveBeenCalled();
            expect(req.principal).toBeUndefined();
            expect(next).not.toHaveBeenCalled();
        });
    });
});
