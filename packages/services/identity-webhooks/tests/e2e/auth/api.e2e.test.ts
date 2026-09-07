import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provisionCompleteUser } from '@kitchensink/identity-utils';

/**
 * E2E: the identityWebhook Lambda exercised end-to-end against mocked AWS SDK
 * clients and a mocked Postgres pool.
 *
 * Covers: identityWebhook — Svix signature verify → user.created / user.deleted dispatch.
 *
 * @implements REQ-013..REQ-017 FR-013..FR-017 ARCH-024 ARCH-025 MOD-024 MOD-025
 */

const mockUpsert = vi.fn();
const mockFindByIdentityId = vi.fn();
const mockRecordOnce = vi.fn();
const mockHasProcessed = vi.fn().mockResolvedValue(false);
const mockSetExternalId = vi.fn();
const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);
const mockSqsSend = vi.fn().mockResolvedValue({});
const mockDbInsertReturning = vi.fn().mockResolvedValue([{ id: 'profile-1' }]);
// Shared insert spy so tests can assert which tables the handler writes (e.g. the account backstop).
const mockDbInsert = vi.fn(() => ({
    values: () => ({
        onConflictDoUpdate: () => ({ returning: mockDbInsertReturning }),
        onConflictDoNothing: () => Promise.resolve(),
        returning: mockDbInsertReturning,
    }),
}));

const buildDb = () => ({
    insert: mockDbInsert,
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
});

vi.mock('../../../src/common/db.js', () => ({
    getDb: vi.fn(async () => buildDb()),
}));
vi.mock('../../../src/common/svix.js', () => ({
    verifyWebhook: vi.fn((_headers: unknown, body: string) => JSON.parse(body)),
}));
vi.mock('../../../src/common/identityClient.js', () => ({
    setExternalId: mockSetExternalId,
    getUser: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([]),
    deleteUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn(function () {
        return {
            upsertByIdentityId: mockUpsert,
            findByIdentityId: mockFindByIdentityId,
            purgePrivateDataByIdentityId: vi.fn(),
        };
    }),
    AccountDAO: vi.fn(function () {
        return {};
    }),
    recordOnce: mockRecordOnce,
    hasProcessedWebhookEvent: mockHasProcessed,
    // `users` is only ever forwarded to the (also-mocked) `db.update` call as an opaque table-identity
    // argument here — never queried for real — so a stub object is sufficient.
    users: { id: 'users-table-stub' },
}));
// user.created provisions the complete unit through the shared routine; the handler no longer drives
// the user/account/profile writes itself, so mock the routine (its real behavior is proven by the
// identity-service Postgres integration test) and assert the handler delegates with the right policy.
vi.mock('../../../src/common/provisioning.js', () => ({ buildProvisionDeps: vi.fn(() => ({})) }));
vi.mock('@kitchensink/identity-utils', () => ({ provisionCompleteUser: vi.fn() }));
vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function () {
        return { send: mockSqsSend };
    }),
    SendMessageCommand: vi.fn(function (input: unknown) {
        return { input };
    }),
}));
vi.mock('../../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (e: T, c: unknown) => Promise<R>) => fn,
}));

afterEach(() => {
    vi.clearAllMocks();
    mockSqsSend.mockResolvedValue({});
    mockDbInsertReturning.mockResolvedValue([{ id: 'profile-1' }]);
});

beforeEach(() => {
    process.env['AUTH_SECRET_ARN'] = 'sk_test_dummy';
    process.env['IDP_WEBHOOK_SECRET'] = 'whsec_dummy';
    process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:000:secret:db';
    process.env['DELETION_QUEUE_URL'] = 'http://localhost:4566/queue/identity-deletions';
});

const ctx = { getRemainingTimeInMillis: () => 5000 } as Context;

/**
 * `aws-lambda`'s `Handler` declares three parameters and returns `void | Promise<TResult>`, so calling it as
 * `handler(event, ctx)` and reading `result.statusCode` is a type error even though it is exactly how the
 * runtime invokes an async handler. Narrowed through the same alias
 * `src/handlers/__tests__/identityWebhook.test.ts` already uses, rather than a new form — this tier simply
 * never had a typecheck project to make the mismatch visible (12 x TS2554 plus 5 x TS2339).
 */
type TestHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

/** Load the webhook handler under the narrowed call signature. @sideEffect Dynamically imports the module. */
const loadWebhookHandler = async (): Promise<TestHandler> => {
    const { handler } = await import('../../../src/handlers/identityWebhook.js');

    return handler as unknown as TestHandler;
};

const makeWebhookEvent = (svixId: string, body: object): APIGatewayProxyEvent =>
    ({
        body: JSON.stringify(body),
        headers: {
            'svix-id': svixId,
            'svix-timestamp': String(Date.now()),
            'svix-signature': 'v1,sig-dummy',
        },
        requestContext: { requestId: `req-${svixId}` },
    }) as unknown as APIGatewayProxyEvent;

const userPayload = (id: string) => ({
    id,
    email_addresses: [{ id: 'email-1', email_address: `${id}@example.com` }],
    first_name: 'E2E',
    last_name: 'User',
    image_url: 'https://i.example/p.jpg',
});

describe('e2e: identityWebhook Lambda', () => {
    it('processes user.created → provisions the complete unit (signal-incomplete policy), syncs external id', async () => {
        mockRecordOnce.mockResolvedValueOnce(true);
        mockProvisionCompleteUser.mockResolvedValueOnce({
            kind: 'complete',
            user: { id: '01USERCREATED0000000000000' },
        } as never);
        const handler = await loadWebhookHandler();

        const event = makeWebhookEvent('svix-create-1', {
            type: 'user.created',
            data: userPayload('user_created_e2e'),
        });
        const result = await handler(event, ctx);

        expect(result.statusCode).toBe(200);
        // The webhook is a complete backstop: one routine call owns user + account + profile, using the
        // signal-incomplete policy so a foreign-email collision is skipped rather than retry-stormed.
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                identityId: 'user_created_e2e',
                email: 'user_created_e2e@example.com',
            }),
            { onEmailCollision: 'signal-incomplete', emailIsReal: true },
        );
        expect(mockSetExternalId).toHaveBeenCalledWith('user_created_e2e', '01USERCREATED0000000000000');
    });

    it('processes user.deleted → enqueues deletion job to SQS', async () => {
        mockRecordOnce.mockResolvedValueOnce(true);
        const handler = await loadWebhookHandler();

        const event = makeWebhookEvent('svix-delete-1', {
            type: 'user.deleted',
            data: { id: 'user_to_delete_e2e' },
        });
        const result = await handler(event, ctx);

        expect(result.statusCode).toBe(200);
        expect(mockSqsSend).toHaveBeenCalledOnce();
        const sentInput = (mockSqsSend.mock.calls[0][0] as { input: { MessageBody: string; QueueUrl: string } }).input;
        expect(sentInput.QueueUrl).toBe('http://localhost:4566/queue/identity-deletions');
        expect(JSON.parse(sentInput.MessageBody)).toEqual({ identityId: 'user_to_delete_e2e' });
    });

    it('is idempotent on duplicate svix-id (no re-processing)', async () => {
        mockHasProcessed.mockResolvedValueOnce(true);
        const handler = await loadWebhookHandler();

        const event = makeWebhookEvent('svix-dup-1', {
            type: 'user.created',
            data: userPayload('user_dup_e2e'),
        });
        const result = await handler(event, ctx);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toMatchObject({ dedup: true });
        expect(mockProvisionCompleteUser).not.toHaveBeenCalled();
    });

    it('rejects requests with invalid Svix signature (401)', async () => {
        const svix = await import('../../../src/common/svix.js');

        vi.mocked(svix.verifyWebhook).mockImplementationOnce(() => {
            throw new Error('signature mismatch');
        });
        const handler = await loadWebhookHandler();

        const event = makeWebhookEvent('svix-bad-1', {
            type: 'user.created',
            data: userPayload('user_bad_sig'),
        });
        const result = await handler(event, ctx);

        expect(result.statusCode).toBe(401);
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });
});
