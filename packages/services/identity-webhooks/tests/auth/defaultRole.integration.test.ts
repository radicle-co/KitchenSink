import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-up role writer across the Clerk boundary (plan 2026-10-14-009 D10): the REAL webhook handler and the REAL
 * `identityClient` (so the real `@clerk/backend` SDK) against Clerk's Backend API served by msw. The database, svix
 * and SQS are mocked, as in `api.integration.test.ts`.
 *
 * What this tier proves that the unit tier cannot: the HTTP the SDK actually sends — a fresh `GET /users/{id}`, then a
 * `PATCH /users/{id}/metadata` whose body carries ONLY `public_metadata.roles` (Clerk deep-merges that endpoint, so no
 * other key is touched) — and that a user created WITH roles is never patched.
 */

const CLERK_API = 'https://api.clerk.com/v1';

const mockRecordOnce = vi.fn().mockResolvedValue(true);
const mockHasProcessed = vi.fn().mockResolvedValue(false);

vi.mock('../../src/common/db.js', () => ({
    getDb: vi.fn(async () => ({
        update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    })),
}));
vi.mock('../../src/common/svix.js', () => ({
    verifyWebhook: vi.fn((_headers: unknown, body: string) => JSON.parse(body)),
}));
vi.mock('@kitchensink/identity-db', () => ({
    UserDAO: vi.fn(function () {
        return { findByIdentityId: vi.fn() };
    }),
    AccountDAO: vi.fn(function () {
        return {};
    }),
    recordOnce: mockRecordOnce,
    hasProcessedWebhookEvent: mockHasProcessed,
    users: { id: 'users-table-stub' },
}));
vi.mock('../../src/common/provisioning.js', () => ({ buildProvisionDeps: vi.fn(() => ({})) }));
vi.mock('@kitchensink/identity-utils', () => ({
    provisionCompleteUser: vi.fn().mockResolvedValue({ kind: 'complete', user: { id: '01ROLEUSER000000000000000' } }),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function () {
        return { send: vi.fn().mockResolvedValue({}) };
    }),
    SendMessageCommand: vi.fn(function (input: unknown) {
        return { input };
    }),
}));
vi.mock('../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    captureProvisioningFailure: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (e: T, c: unknown) => Promise<R>) => fn,
}));

/** What Clerk returns for a user, reduced to what the SDK deserializes. */
const clerkUser = (id: string, publicMetadata: Record<string, unknown>) => ({
    object: 'user',
    id,
    external_id: null,
    email_addresses: [],
    phone_numbers: [],
    web3_wallets: [],
    external_accounts: [],
    saml_accounts: [],
    created_at: 0,
    updated_at: 0,
    first_name: 'Role',
    last_name: 'User',
    public_metadata: publicMetadata,
    private_metadata: {},
    unsafe_metadata: {},
});

let storedMetadata: Record<string, unknown> = {};
let metadataPatches: Record<string, unknown>[] = [];

const server = setupServer(
    http.get(`${CLERK_API}/users/:userId`, ({ params }) =>
        HttpResponse.json(clerkUser(params['userId'] as string, storedMetadata)),
    ),
    http.patch(`${CLERK_API}/users/:userId/metadata`, async ({ params, request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        metadataPatches.push(body);

        return HttpResponse.json(clerkUser(params['userId'] as string, { ...storedMetadata }));
    }),
    // `setExternalId` — best-effort, answered so it does not log a failure.
    http.patch(`${CLERK_API}/users/:userId`, ({ params }) =>
        HttpResponse.json(clerkUser(params['userId'] as string, storedMetadata)),
    ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
    storedMetadata = {};
    metadataPatches = [];
    process.env['IDP_SECRET_KEY'] = 'sk_test_role_writer';
    process.env['IDP_WEBHOOK_SECRET'] = 'whsec_dummy';
    process.env['DB_HOST'] = 'db.internal';
    process.env['DB_PORT'] = '5432';
    process.env['DB_NAME'] = 'kitchensink_identity';
    process.env['DELETION_QUEUE_URL'] = 'http://localhost:4566/queue/identity-deletions';
});

afterEach(() => {
    server.resetHandlers();
    mockRecordOnce.mockClear();
    vi.resetModules();
});

type TestHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

const ctx = { getRemainingTimeInMillis: () => 5000 } as Context;

const userCreated = (svixId: string, id: string): APIGatewayProxyEvent =>
    ({
        body: JSON.stringify({
            type: 'user.created',
            data: {
                id,
                email_addresses: [{ id: 'email-1', email_address: `${id}@example.com` }],
                first_name: 'Role',
                last_name: 'User',
                image_url: null,
            },
        }),
        headers: { 'svix-id': svixId, 'svix-timestamp': String(Date.now()), 'svix-signature': 'v1,sig' },
        requestContext: { requestId: `req-${svixId}` },
    }) as unknown as APIGatewayProxyEvent;

/** @sideEffect Dynamically imports the handler. */
const loadHandler = async (): Promise<TestHandler> => {
    const { handler } = await import('../../src/handlers/identityWebhook.js');

    return handler as unknown as TestHandler;
};

describe('identityWebhook — the default role over the Clerk Backend API', () => {
    it('merges exactly public_metadata.roles = ["default"] for a user created with none', async () => {
        storedMetadata = { testPrincipal: true };
        const handler = await loadHandler();

        const result = await handler(userCreated('svix-role-1', 'user_role_new'), ctx);

        expect(result.statusCode).toBe(200);
        expect(metadataPatches).toStrictEqual([{ public_metadata: { roles: ['default'] } }]);
        expect(mockRecordOnce).toHaveBeenCalledOnce();
    });

    it('never patches a user created WITH roles (a premium pool slot keeps its role)', async () => {
        storedMetadata = { testPrincipal: true, roles: ['premium'], permissions: [], scopes: [] };
        const handler = await loadHandler();

        const result = await handler(userCreated('svix-role-2', 'user_role_premium'), ctx);

        expect(result.statusCode).toBe(200);
        expect(metadataPatches).toStrictEqual([]);
    });

    it('a Clerk outage fails the delivery unrecorded, and the retry writes the role once', async () => {
        server.use(
            http.patch(
                `${CLERK_API}/users/:userId/metadata`,
                () => HttpResponse.json({ errors: [{ code: 'internal', message: 'down' }] }, { status: 500 }),
                { once: true },
            ),
        );
        const handler = await loadHandler();

        await expect(handler(userCreated('svix-role-3', 'user_role_retry'), ctx)).rejects.toThrow();
        expect(mockRecordOnce).not.toHaveBeenCalled();

        const retried = await handler(userCreated('svix-role-3', 'user_role_retry'), ctx);

        expect(retried.statusCode).toBe(200);
        expect(metadataPatches).toStrictEqual([{ public_metadata: { roles: ['default'] } }]);
        expect(mockRecordOnce).toHaveBeenCalledOnce();
    });
});
