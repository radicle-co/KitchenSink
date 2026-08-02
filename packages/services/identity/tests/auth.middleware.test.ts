import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

vi.mock('@sentry/nestjs', () => ({
    captureException: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as Sentry from '@sentry/nestjs';

import { AuthMiddleware } from '../src/auth/middleware/auth.middleware.js';

type AnyReq = {
    headers: Record<string, string | undefined>;
    originalUrl?: string;
    path?: string;
    user?: unknown;
};

function makeReq(overrides: Partial<AnyReq> = {}): AnyReq {
    return { headers: {}, originalUrl: '/api/v1/users/me', path: '/api/v1/users/me', ...overrides };
}

const userCtx = {
    userId: '01HZZZZZZZZZZZZZZZZZZZZZZU',
    email: 'a@b.com',
    clerkUserId: 'user_x',
    scopes: [],
    permissions: [],
    tokenType: 'user' as const,
};

function encodeHeaderCtx(ctx: unknown): string {
    return Buffer.from(JSON.stringify(ctx)).toString('base64');
}

describe('AuthMiddleware', () => {
    let clerkAuth: { verify: ReturnType<typeof vi.fn> };
    let users: { resolveOrCreateFromClaims: ReturnType<typeof vi.fn> };
    let mw: AuthMiddleware;
    let next: ReturnType<typeof vi.fn>;
    const res = {} as never;

    beforeEach(() => {
        clerkAuth = { verify: vi.fn() };
        users = { resolveOrCreateFromClaims: vi.fn() };
        mw = new AuthMiddleware(clerkAuth as never, users as never);
        next = vi.fn();
    });

    it('skips auth for /health', async () => {
        const req = makeReq({ originalUrl: '/health', path: '/health' });

        await mw.use(req as never, res, next as never);

        expect(next).toHaveBeenCalledOnce();
        expect(clerkAuth.verify).not.toHaveBeenCalled();
    });

    it('verifies a Bearer token and read-through resolves the user', async () => {
        clerkAuth.verify.mockResolvedValue({ sub: 'user_x', email: 'a@b.com' });
        users.resolveOrCreateFromClaims.mockResolvedValue(userCtx);

        const req = makeReq({ headers: { authorization: 'Bearer abc.def.ghi' } });
        await mw.use(req as never, res, next as never);

        expect(clerkAuth.verify).toHaveBeenCalledWith('abc.def.ghi');
        expect(users.resolveOrCreateFromClaims).toHaveBeenCalledWith({ sub: 'user_x', email: 'a@b.com' });
        expect(req.user).toBe(userCtx);
        expect(next).toHaveBeenCalledOnce();
    });

    it('emits a distinct, loud Sentry signal (with the Clerk sub) when read-through provisioning fails, then rethrows', async () => {
        clerkAuth.verify.mockResolvedValue({ sub: 'user_x', email: 'a@b.com' });
        const failure = new Error('DB unavailable');
        users.resolveOrCreateFromClaims.mockRejectedValue(failure);

        const req = makeReq({ headers: { authorization: 'Bearer abc.def.ghi' } });

        // The request still fails (5xx) — but loudly and identifiably, not silently.
        await expect(mw.use(req as never, res, next as never)).rejects.toBe(failure);
        expect(Sentry.captureException).toHaveBeenCalledWith(
            failure,
            expect.objectContaining({
                tags: { 'auth.provisioning': 'failed' },
                contexts: { auth: { clerkSub: 'user_x', outcome: 'failed' } },
            }),
        );
        expect(req.user).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects a present-but-invalid Bearer token with 401 and does not fall back to the header', async () => {
        clerkAuth.verify.mockRejectedValue(new UnauthorizedException());

        const req = makeReq({
            headers: { authorization: 'Bearer bad', 'x-authorizer-context': encodeHeaderCtx(userCtx) },
        });

        await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(users.resolveOrCreateFromClaims).not.toHaveBeenCalled();
        expect(req.user).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('does NOT authenticate from a client-supplied x-authorizer-context header (no trusted-header path)', async () => {
        // Security: the service sits behind a public ALB with no upstream authorizer, so a forged
        // x-authorizer-context must never grant identity/admin. Without a Bearer token → hard 401.
        const forgedAdminCtx = { ...userCtx, scopes: ['admin:users'], permissions: ['admin:users'] };
        const req = makeReq({ headers: { 'x-authorizer-context': encodeHeaderCtx(forgedAdminCtx) } });

        await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(req.user).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('throws 401 when no Bearer token is present', async () => {
        const req = makeReq({ headers: {} });

        await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(next).not.toHaveBeenCalled();
    });

    it('authenticates from the Bearer token and ignores any x-authorizer-context header', async () => {
        clerkAuth.verify.mockResolvedValue({ sub: 'user_x' });
        users.resolveOrCreateFromClaims.mockResolvedValue(userCtx);

        const forgedHeaderCtx = { ...userCtx, userId: '01HEADERFORGED000000000000', scopes: ['admin:users'] };
        const req = makeReq({
            headers: { authorization: 'Bearer good', 'x-authorizer-context': encodeHeaderCtx(forgedHeaderCtx) },
        });

        await mw.use(req as never, res, next as never);

        expect(clerkAuth.verify).toHaveBeenCalledOnce();
        expect(req.user).toBe(userCtx); // from the verified JWT, never the forged header
    });

    describe('dev-auth bypass (IDENTITY_DEV_AUTH_USER_ID)', () => {
        const DEV_KEYS = ['NODE_ENV', 'IDENTITY_DEV_AUTH_USER_ID'] as const;
        const saved: Record<string, string | undefined> = {};

        beforeEach(() => {
            for (const key of DEV_KEYS) {
                saved[key] = process.env[key];
            }
        });

        afterEach(() => {
            for (const key of DEV_KEYS) {
                if (saved[key] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = saved[key];
                }
            }
        });

        it('injects a fixed synthetic principal outside production — no token, no Clerk verify, no DB read-through', async () => {
            process.env['NODE_ENV'] = 'development';
            process.env['IDENTITY_DEV_AUTH_USER_ID'] = '01HZZDEVBYPASSULID00000000';

            const req = makeReq({ headers: {} }); // deliberately NO bearer token

            await mw.use(req as never, res, next as never);

            expect(next).toHaveBeenCalledOnce();
            expect(clerkAuth.verify).not.toHaveBeenCalled();
            expect(users.resolveOrCreateFromClaims).not.toHaveBeenCalled();
            expect(req.user).toMatchObject({
                userId: '01HZZDEVBYPASSULID00000000',
                clerkUserId: 'dev-bypass:01HZZDEVBYPASSULID00000000',
                scopes: [],
                permissions: [],
                tokenType: 'user',
            });
        });

        it('is HARD-DISABLED in production even when the env var is set → falls through to a 401', async () => {
            process.env['NODE_ENV'] = 'production';
            process.env['IDENTITY_DEV_AUTH_USER_ID'] = '01HZZDEVBYPASSULID00000000';

            const req = makeReq({ headers: {} });

            await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
            expect(req.user).toBeUndefined();
            expect(next).not.toHaveBeenCalled();
        });

        it('is inert when the env var is unset → normal bearer path applies', async () => {
            process.env['NODE_ENV'] = 'development';
            delete process.env['IDENTITY_DEV_AUTH_USER_ID'];

            const req = makeReq({ headers: {} });

            await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
