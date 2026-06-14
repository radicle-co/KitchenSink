import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { AuthMiddleware } from '../src/auth/middleware/auth.middleware.js';

type AnyReq = {
    headers: Record<string, string | undefined>;
    originalUrl?: string;
    path?: string;
    user?: unknown;
};

function makeReq(overrides: Partial<AnyReq> = {}): AnyReq {
    return { headers: {}, originalUrl: '/v1/users/me', path: '/v1/users/me', ...overrides };
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

    it('falls back to a valid x-authorizer-context header when no Bearer is present', async () => {
        const req = makeReq({ headers: { 'x-authorizer-context': encodeHeaderCtx(userCtx) } });

        await mw.use(req as never, res, next as never);

        expect((req.user as typeof userCtx).userId).toBe(userCtx.userId);
        expect(clerkAuth.verify).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });

    it('throws 401 when neither a Bearer token nor a valid header is present', async () => {
        const req = makeReq({ headers: {} });

        await expect(mw.use(req as never, res, next as never)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(next).not.toHaveBeenCalled();
    });

    it('prefers the Bearer token over a present header', async () => {
        clerkAuth.verify.mockResolvedValue({ sub: 'user_x' });
        users.resolveOrCreateFromClaims.mockResolvedValue(userCtx);

        const staleHeaderCtx = { ...userCtx, userId: '01HEADERSTALE0000000000000' };
        const req = makeReq({
            headers: { authorization: 'Bearer good', 'x-authorizer-context': encodeHeaderCtx(staleHeaderCtx) },
        });

        await mw.use(req as never, res, next as never);

        expect(clerkAuth.verify).toHaveBeenCalledOnce();
        expect(req.user).toBe(userCtx);
    });
});
