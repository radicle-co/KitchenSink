import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../../common/svix.js', () => ({ verifyWebhook: vi.fn() }));
vi.mock('../../common/identityClient.js', () => ({ setExternalId: vi.fn() }));

vi.mock('@kitchensink/identity-service/database/dao', () => ({
    UserDAO: vi.fn().mockImplementation(function () {
        return {
            upsertByIdentityId: vi.fn(),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
    }),
    recordOnce: vi.fn(),
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
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { UserDAO } from '@kitchensink/identity-service/database/dao';
import { recordOnce } from '@kitchensink/identity-service/database/dao';

import { handler as rawHandler } from '../identityWebhook.js';
import { getDb } from '../../common/db.js';
import { setExternalId } from '../../common/identityClient.js';
import { verifyWebhook } from '../../common/svix.js';

type TestHandler = (event: APIGatewayProxyEvent, ctx: Context) => Promise<APIGatewayProxyResult>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockVerifyWebhook = vi.mocked(verifyWebhook);
const mockRecordOnce = vi.mocked(recordOnce);
const mockSetExternalId = vi.mocked(setExternalId);

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
    const valuesProfile = vi
        .fn()
        .mockReturnValue({ returning: returningProfile, onConflictDoUpdate: onConflictDoUpdateProfile });
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
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.DELETION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/deletion-queue';
    process.env.IDP_WEBHOOK_SECRET = 'whsec_test';
});

describe('identity-webhook handler', () => {
    it('duplicate svix-id returns 200 immediately', async () => {
        const { db } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockRecordOnce.mockResolvedValue(false);

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_123');
        expect(mockSetExternalId).not.toHaveBeenCalled();
    });

    it('user.created -> upserts user, sets external id, syncs timestamp, inserts profile', async () => {
        const { db, setUser, valuesProfile, insertProfile, onConflictDoUpdateProfile } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userCreatedPayload as never);
        mockRecordOnce.mockResolvedValue(true);

        const daoInstance = {
            upsertByIdentityId: vi.fn().mockResolvedValue({
                id: 'usr_ulid',
                identityId: 'user_abc123',
                email: 'test@example.com',
                name: 'John Doe',
                picture: 'https://example.com/avatar.png',
            }),
            findByIdentityId: vi.fn(),
            updateProfile: vi.fn(),
        };
        vi.mocked(UserDAO).mockImplementation(function () {
            return daoInstance;
        });

        const result = await handler(
            makeEvent(JSON.stringify(userCreatedPayload), { 'svix-id': 'msg_123' }),
            makeContext(),
        );

        expect(result.statusCode).toBe(200);
        expect(mockRecordOnce).toHaveBeenCalledWith(db, 'msg_123');
        expect(daoInstance.upsertByIdentityId).toHaveBeenCalledWith({
            identityId: 'user_abc123',
            email: 'test@example.com',
            name: 'John Doe',
            picture: 'https://example.com/avatar.png',
        });
        expect(mockSetExternalId).toHaveBeenCalledWith('user_abc123', 'usr_ulid');
        expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ externalIdSyncedAt: expect.any(Date) }));
        expect(insertProfile).toHaveBeenCalled();
        expect(valuesProfile).toHaveBeenCalledWith({
            userId: 'usr_ulid',
            displayName: 'John Doe',
            avatarUrl: 'https://example.com/avatar.png',
        });
        expect(onConflictDoUpdateProfile).toHaveBeenCalled();
    });

    it('user.updated with email and name change -> updates users and profiles', async () => {
        const { db, setUser, whereUser } = buildMockDb();
        mockGetDb.mockResolvedValue(db);
        mockVerifyWebhook.mockReturnValue(userUpdatedPayload as never);
        mockRecordOnce.mockResolvedValue(true);

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
        mockRecordOnce.mockResolvedValue(true);

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
        expect(SendMessageCommand).toHaveBeenCalledWith({
            QueueUrl: process.env.DELETION_QUEUE_URL,
            MessageBody: JSON.stringify({ userId: 'user_abc123' }),
        });
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
