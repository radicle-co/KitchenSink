import type { APIGatewayRequestAuthorizerEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));

vi.mock('@sentry/aws-serverless', () => ({
    captureException: mockCaptureException,
}));

vi.mock('../../common/observability.js', () => ({
    withObservability: <T>(fn: T): T => fn,
}));

vi.mock('../../common/jwt.js', () => ({
    verifyClerkJwt: vi.fn(),
}));

vi.mock('../../common/identityClient.js', () => ({
    getUser: vi.fn(),
    setExternalId: vi.fn(),
}));

vi.mock('../../common/db.js', () => ({
    getDb: vi.fn(),
}));

vi.mock('@kitchensink/identity-service/database/dao', () => ({
    UserDAO: vi.fn(function (this: any) {
        this.upsertByIdentityId = vi.fn().mockResolvedValue({
            id: '01HJIT0123456789ABCDEFGHIJ',
            identityId: 'user_identityId_new',
            email: 'new@example.com',
            name: 'New User',
            picture: null,
        });
    }),
}));

import { handler as rawHandler } from '../handler.js';
import { verifyClerkJwt } from '../../common/jwt.js';
import { getUser, setExternalId } from '../../common/identityClient.js';
import { getDb } from '../../common/db.js';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import type { APIGatewayAuthorizerResult } from 'aws-lambda';

const handler = rawHandler as unknown as (
    event: APIGatewayRequestAuthorizerEvent,
    context: Context,
) => Promise<APIGatewayAuthorizerResult>;

const mockVerifyClerkJwt = vi.mocked(verifyClerkJwt);
const mockGetUser = vi.mocked(getUser);
const mockSetExternalId = vi.mocked(setExternalId);
const mockGetDb = vi.mocked(getDb);

const makeEvent = (authorization?: string): APIGatewayRequestAuthorizerEvent =>
    ({
        type: 'REQUEST',
        methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api/stage/GET/resource',
        headers: authorization ? { Authorization: authorization } : {},
        requestContext: { requestId: 'test-request-id' },
    }) as unknown as APIGatewayRequestAuthorizerEvent;

const makeContext = (): Context => ({}) as unknown as Context;

const TEST_USER_ID = '01HXYZ1234567890ABCDEFGHIJ' as import('@kitchensink/identity-service').UserId;
const JIT_USER_ID = '01HJIT0123456789ABCDEFGHIJ' as import('@kitchensink/identity-service').UserId;

beforeEach(() => {
    vi.clearAllMocks();
    process.env.IDP_ISSUER = 'https://idp.test.example.com';
    process.env.IDP_JWKS_URL = 'https://idp.test.example.com/.well-known/jwks.json';
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
});

describe('handler', () => {
    it('valid user token with app_user_id → Allow policy with correct context', async () => {
        mockVerifyClerkJwt.mockResolvedValueOnce({
            sub: 'user_identityId123',
            app_user_id: TEST_USER_ID,
            email: 'user@example.com',
            iss: 'https://idp.test.example.com',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        } as any);

        const result = await handler(makeEvent('Bearer valid.user.token'), makeContext());

        expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
        expect(result.principalId).toBe('user_identityId123');
        expect(result.context?.clerkUserId).toBe('user_identityId123');
        expect(result.context?.userId).toBe(TEST_USER_ID);
        expect(result.context?.email).toBe('user@example.com');
        expect(result.context?.tokenType).toBe('user');
        expect(result.context?.scopes).toBe(JSON.stringify([]));
        expect(result.context?.permissions).toBe(JSON.stringify([]));
    });

    it('token missing app_user_id → JIT path → Allow policy with new userId', async () => {
        mockVerifyClerkJwt.mockResolvedValueOnce({
            sub: 'user_identityId_new',
            email: 'new@example.com',
            iss: 'https://idp.test.example.com',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        } as any);

        mockGetUser.mockResolvedValueOnce({
            id: 'user_identityId_new',
            emailAddresses: [{ emailAddress: 'new@example.com' }],
            firstName: 'New',
            lastName: 'User',
            imageUrl: 'https://img.example.com/pic.jpg',
        } as any);

        mockGetDb.mockResolvedValueOnce({} as any);

        const result = await handler(makeEvent('Bearer valid.noappuser.token'), makeContext());

        expect(mockGetUser).toHaveBeenCalledWith('user_identityId_new');
        expect(mockGetDb).toHaveBeenCalledWith(process.env.DB_SECRET_ARN);
        expect(UserDAO).toHaveBeenCalled();
        expect(mockSetExternalId).toHaveBeenCalledWith('user_identityId_new', JIT_USER_ID);

        expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
        expect(result.principalId).toBe('user_identityId_new');
        expect(result.context?.userId).toBe(JIT_USER_ID);
    });

    it('JWT validation failure → captures a sanitized exception and denies (AE4)', async () => {
        mockVerifyClerkJwt.mockRejectedValueOnce(new Error('invalid signature for token eyJ.aaa.bbb'));

        await expect(handler(makeEvent('Bearer expired.token'), makeContext())).rejects.toThrow('Unauthorized');

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        const captured = mockCaptureException.mock.calls[0]?.[0] as Error;
        // PII guard: the captured error must not carry the raw cause / token / email.
        expect(captured.message).toBe('authorizer unexpected failure');
        expect((captured as Error & { cause?: unknown }).cause).toBeUndefined();
        expect(JSON.stringify(captured)).not.toContain('eyJ.aaa.bbb');
    });

    it('missing Authorization header → denies without capturing (routine)', async () => {
        await expect(handler(makeEvent(), makeContext())).rejects.toThrow('Unauthorized');
        expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('malformed Authorization header → denies without capturing (routine)', async () => {
        await expect(handler(makeEvent('NotBearer token'), makeContext())).rejects.toThrow('Unauthorized');
        expect(mockCaptureException).not.toHaveBeenCalled();
    });
});
