import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizerContext } from '../src/types/index.js';

const { mockSetAttributes, mockSetUser } = vi.hoisted(() => ({
    mockSetAttributes: vi.fn(),
    mockSetUser: vi.fn(),
}));

vi.mock('@sentry/nestjs', () => ({
    getIsolationScope: () => ({ setAttributes: mockSetAttributes }),
    setUser: mockSetUser,
}));

import { SentryContextMiddleware } from '../src/observability/sentryContext.middleware.js';

const makeReq = (overrides: Partial<Request & { user?: AuthorizerContext }>): Request & { user?: AuthorizerContext } =>
    ({ headers: {}, ...overrides }) as Request & { user?: AuthorizerContext };

describe('SentryContextMiddleware', () => {
    let middleware: SentryContextMiddleware;
    let next: NextFunction;

    beforeEach(() => {
        vi.clearAllMocks();
        middleware = new SentryContextMiddleware();
        next = vi.fn();
    });

    it('sets service context + request id and the user for an authenticated request', () => {
        const req = makeReq({
            headers: { 'x-request-id': 'req-42' },
            user: {
                userId: 'u1',
                email: 'u1@example.com',
                clerkUserId: 'idp_1',
                scopes: [],
                permissions: [],
                tokenType: 'user',
            } as unknown as AuthorizerContext,
        });

        middleware.use(req, {} as Response, next);

        expect(mockSetAttributes).toHaveBeenCalledWith(
            expect.objectContaining({ serviceName: 'identity-service', request_id: 'req-42' }),
        );
        expect(mockSetUser).toHaveBeenCalledWith({ id: 'u1' });
        expect(next).toHaveBeenCalledOnce();
    });

    it('skips setUser when there is no authenticated user (e.g. /health)', () => {
        const req = makeReq({ headers: {} });

        middleware.use(req, {} as Response, next);

        expect(mockSetAttributes).toHaveBeenCalled();
        expect(mockSetUser).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledOnce();
    });
});
