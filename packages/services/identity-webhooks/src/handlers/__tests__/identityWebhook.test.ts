import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../common/svix.js', () => ({ verifyWebhook: vi.fn() }));
vi.mock('../../common/identityClient.js', () => ({ setExternalId: vi.fn() }));
vi.mock('../../common/provisioning.js', () => ({ buildProvisionDeps: vi.fn(() => ({})) }));
vi.mock('@kitchensink/identity-utils', () => ({ provisionCompleteUser: vi.fn() }));

vi.mock('@kitchensink/identity-service/database/dao', () => ({
    UserDAO: vi.fn().mockImplementation(function () {
        return {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
    }),
    recordOnce: vi.fn().mockResolvedValue(undefined),
    hasProcessedWebhookEvent: vi.fn().mockResolvedValue(false),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function SQSClient() {
        return { send: vi.fn().mockResolvedValue({}) };
    }),
    SendMessageCommand: vi.fn(function SendMessageCommand(input: unknown) {
        return { input };
    }),
}));
vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    captureProvisioningFailure: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import { recordOnce, hasProcessedWebhookEvent } from '@kitchensink/identity-service/database/dao';

import { handler as rawHandler } from '../identityWebhook.js';
import { getDb } from '../../common/db.js';
import { setExternalId } from '../../common/identityClient.js';
import { provisionCompleteUser } from '@kitchensink/identity-utils';
import { captureProvisioningFailure } from '../../common/observability.js';
import { verifyWebhook } from '../../common/svix.js';

type TestHandler = (event: APIGatewayProxyEvent, ctx: Context) => Promise<APIGatewayProxyResult>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockVerifyWebhook = vi.mocked(verifyWebhook);
const mockRecordOnce = vi.mocked(recordOnce);
const mockHasProcessed = vi.mocked(hasProcessedWebhookEvent);
const mockSetExternalId = vi.mocked(setExternalId);
const mockProvisionCompleteUser = vi.mocked(provisionCompleteUser);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeEvent = (body: string, headers: Record<string, string> = {}): APIGatewayProxyEvent =>
    ({
        body,
        headers,
        requestContext: { requestId: 'test-req-id' },
    }) as unknown as APIGatewayProxyEvent;

const userCreatedPayload = {
    type: 'user.created' as const,
    data: {
        id: 'user_abc123',
        email_addresses: [{ id: 'email_1', email_address: 'test@example.com' }],
        first_name: 'John',
        last_name: 'Doe',
        image_url: 'https://example.com/avatar.png',
    },
    object: 'event' as const,
};

const userUpdatedPayload = {
    type: 'user.updated' as const,
    data: {
        id: 'user_abc123',
        email_addresses: [{ id: 'email_1', email_address: 'updated@example.com' }],
        first_name: 'Jane',
        last_name: 'Doe',
        image_url: 'https://example.com/new-avatar.png',
    },
    object: 'event' as const,
};

const userDeletedPayload = {
    type: 'user.deleted' as const,
    data: { id: 'user_abc123' },
    object: 'event' as const,
};

const buildMockDb = () => {
    const returningUser = vi.fn().mockResolvedValue([{ id: 'usr_ulid' }]);
    const whereUser = vi.fn().mockReturnValue({ returning: returningUser });
    const setUser = vi.fn().mockReturnValue({ where: whereUser });
    const updateUser = vi.fn().mockReturnValue({ set: setUser });

    const returningProfile = vi.fn().mockResolvedValue([{ id: 'prof_1' }]);
    const onConflictDoUpdateProfile = vi.fn().mockReturnValue({ returning: returningProfile });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const valuesProfile = vi.fn().mockReturnValue({
        returning: returningProfile,
        onConflictDoUpdate: onConflictDoUpdateProfile,
        onConflictDoNothing,
    });
    const insertProfile = vi.fn().mockReturnValue({ values: valuesProfile });

    const db = {
        insert: vi.fn((table: unknown) => insertProfile(table)),
        update: vi.fn((table: unknown) => updateUser(table)),
    } as never;

    return {
        db,
        returningUser,
        whereUser,
        setUser,
        updateUser,
        returningProfile,
        valuesProfile,
        insertProfile,
        onConflictDoUpdateProfile,
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but NOT implementations, so re-assert the per-test defaults
    // to prevent a `hasProcessed → true` set in one test from leaking into the next.
    mockHasProcessed.mockResolvedValue(false);
    mockRecordOnce.mockResolvedValue(undefined);
    mockSetExternalId.mockResolvedValue(undefined as never);
    mockProvisionCompleteUser.mockResolvedValue({ kind: 'complete', user: { id: 'usr_ulid' } } as never);
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.DELETION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue';
    process.env.IDP_WEBHOOK_SECRET = 'whsec_test';
});

describe('identity-webhook handler', () => {
    it('already-processed svix-id dedups to 200 without processing or re-recording', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockHasProcessed.mockResolvedValue(true);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockHasProcessed).toHaveBeenCalledWith(db, 'msg_123');
        // Confirm-after-process: a duplicate neither re-processes nor re-records.
        expect(mockSetExternalId).not.toHaveBeenCalled();
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });

    it('user.created -> provisions the complete user via the shared routine, sets external id, syncs timestamp', async () => {
        const { db, setUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockProvisionCompleteUser.mockResolvedValue({
            kind: 'complete',
            user: { id: 'usr_ulid', identityId: 'user_abc123', email: 'test@example.com' },
        } as never);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_123', 'user_abc123', 'user.created');
        // One routine call owns user + account + profile; the webhook uses the signal-incomplete policy.
        expect(mockProvisionCompleteUser).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                displayName: 'John Doe',
                avatarUrl: 'https://example.com/avatar.png',
            }),
            { onEmailCollision: 'signal-incomplete', emailIsReal: true },
        );
        // External id backfill runs AFTER the complete local unit, and stamps the sync marker on success.
        expect(mockSetExternalId).toHaveBeenCalledWith('user_abc123', 'usr_ulid');
        expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ externalIdSyncedAt: expect.any(Date) }));
    });

    it('user.created with an email owned by another active identity -> skips (no 502), still 200', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        // The routine signals incomplete on a cross-identity email collision; the read-through provisions
        // this user (with its placeholder fallback) on first login, so the webhook must NOT retry-storm.
        mockProvisionCompleteUser.mockResolvedValue({ kind: 'incomplete', reason: 'email-collision' } as never);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockSetExternalId).not.toHaveBeenCalled();
        expect(mockRecordOnce).toHaveBeenCalled(); // processed (a duplicate redelivery dedups, not retries)
        // R5 taxonomy: the EXPECTED email-collision fallback must NOT page.
        expect(vi.mocked(captureProvisioningFailure)).not.toHaveBeenCalled();
    });

    it('user.created completes account+profile even when setExternalId throws (does not abort, still 200)', async () => {
        const { db, setUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        // The bug class this guards: a non-critical external Clerk call must not block the local user
        // unit. setExternalId throwing used to abort the handler AFTER the user row, leaving no account.
        mockSetExternalId.mockRejectedValue(new Error('Clerk 503'));

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The complete user unit is provisioned by the routine before the external call, so it lands.
        expect(mockProvisionCompleteUser).toHaveBeenCalled();
        // The webhook is recorded as processed (no retry storm) and the synced timestamp is NOT stamped,
        // so reconciliation knows external_id still needs backfilling.
        expect(mockRecordOnce).toHaveBeenCalled();
        expect(setUser).not.toHaveBeenCalledWith(expect.objectContaining({ externalIdSyncedAt: expect.any(Date) }));
    });

    it('user.updated with email and name change -> updates users and profiles', async () => {
        const { db, setUser, whereUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userUpdatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: 'https://example.com/avatar.png',
            }),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userUpdatedPayload), { 'svix-id': 'msg_456' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(setUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'updated@example.com', updatedAt: expect.any(Date) }),
        );
        expect(whereUser).toHaveBeenCalledWith(expect.anything());
    });

    it('user.deleted -> enqueues SQS deletion message', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userDeletedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userDeletedPayload), { 'svix-id': 'msg_789' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        // The deletion-worker parses `identityId` from the body — the message MUST carry that key,
        // not `userId`, or every webhook-driven deletion silently no-ops once the worker consumes
        // the queue (U1 / A1 deletion-payload alignment).
        expect(SendMessageCommand).toHaveBeenCalledWith({
            QueueUrl: process.env.DELETION_QUEUE_URL,
            MessageBody: JSON.stringify({ identityId: 'user_abc123' }),
        });
    });

    it('does NOT record the svix-id when processing fails (so svix retries, not deduped away)', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: null,
            }),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });
        // A GENUINE processing failure (the local user unit couldn't be completed). Note this is NOT
        // setExternalId — that's best-effort now and must not fail the webhook; a DB error inside the
        // provisioning routine is the real "processing failed" case that should make svix retry.
        mockProvisionCompleteUser.mockRejectedValue(new Error('db unavailable'));

        await expect(
            handler(makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_fail' }), makeContext()),
        ).rejects.toThrow('db unavailable');

        // Confirm-after-process: the svix-id is NOT recorded on failure, so svix's retry re-processes
        // instead of short-circuiting to dedup (the original A2 event-loss failure mode).
        expect(mockRecordOnce).not.toHaveBeenCalled();
        // R5: a genuine failure emits the distinct paging signal (carrying only the Clerk identity id).
        expect(vi.mocked(captureProvisioningFailure)).toHaveBeenCalledWith(expect.any(Error), 'user_abc123');
    });

    it('records the svix-id on the PK only after a successful user.created', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);

        const daoInstance = {
            upsertByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: null,
            }),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_ok' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_ok', 'user_abc123', 'user.created');
    });

    it('invalid signature -> returns 401', async () => {
        mockVerifyWebhook.mockImplementation(() => {
            throw new Error('Invalid signature');
        });

        const result = await handler(makeEvent(JSON.stringify(userCreatedPayload), {}), makeContext());

        expect(result.statusCode).toBe(401);
        expect(mockRecordOnce).not.toHaveBeenCalled();
    });
});
