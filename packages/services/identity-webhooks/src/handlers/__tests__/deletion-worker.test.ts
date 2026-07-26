import type { Context, SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/db.js', () => ({
    getDb: vi.fn(),
}));

const mockPurgePrivateData = vi.fn();

vi.mock('@kitchensink/identity-db', () => {
    const UserDAO = vi.fn().mockImplementation(function () {
        return {
            purgePrivateDataByIdentityId: mockPurgePrivateData,
        };
    });

    return { UserDAO };
});

vi.mock('../../common/identityClient.js', () => ({
    banUser: vi.fn().mockResolvedValue(undefined),
    unbanUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../deletion-worker.js';
import { getDb } from '../../common/db.js';
import { banUser, unbanUser } from '../../common/identityClient.js';
import { resetConfigCacheForTests } from '../../config/env.js';

type TestHandler = (event: SQSEvent, ctx: Context) => Promise<void>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockBanUser = vi.mocked(banUser);
const mockUnbanUser = vi.mocked(unbanUser);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeSqsEvent = (body: Record<string, unknown>): SQSEvent => ({
    Records: [
        {
            messageId: 'msg-1',
            receiptHandle: 'receipt-1',
            body: JSON.stringify(body),
            attributes: {
                ApproximateReceiveCount: '1',
                SentTimestamp: '1234567890',
                SenderId: 'sender-1',
                ApproximateFirstReceiveTimestamp: '1234567890',
            },
            messageAttributes: {},
            md5OfBody: 'abc123',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-east-1:123:deletion-queue',
            awsRegion: 'us-east-1',
        },
    ],
});

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    mockGetDb.mockResolvedValue({} as never);
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
});

describe('deletion-worker handler', () => {
    describe('legacy user.deleted purge (no event field)', () => {
        it('existing user → private data purged, no Clerk mutation', async () => {
            const identityId = 'user_abc123';
            const userRow = { id: 'usr_01', identityId, email: 'test@example.com', deletedAt: new Date() };

            mockPurgePrivateData.mockResolvedValue(userRow);

            await expect(handler(makeSqsEvent({ identityId }), makeContext())).resolves.toBeUndefined();

            expect(mockPurgePrivateData).toHaveBeenCalledWith(identityId);
            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockUnbanUser).not.toHaveBeenCalled();
        });

        it('missing user → no error thrown (idempotent)', async () => {
            mockPurgePrivateData.mockResolvedValue(undefined);

            await expect(handler(makeSqsEvent({ identityId: 'user_nope' }), makeContext())).resolves.toBeUndefined();

            expect(mockPurgePrivateData).toHaveBeenCalledWith('user_nope');
        });
    });

    describe('lifecycle routing (event field)', () => {
        it('closure → BANS the Clerk identity, never purges the identity DB', async () => {
            await handler(
                makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }),
                makeContext(),
            );

            expect(mockBanUser).toHaveBeenCalledWith('user_abc');
            expect(mockUnbanUser).not.toHaveBeenCalled();
            expect(mockPurgePrivateData).not.toHaveBeenCalled();
        });

        it('reactivation → UNBANS the Clerk identity', async () => {
            await handler(
                makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'reactivation' }),
                makeContext(),
            );

            expect(mockUnbanUser).toHaveBeenCalledWith('user_abc');
            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockPurgePrivateData).not.toHaveBeenCalled();
        });

        it('erasure → leaves the recipe/food fan-out seam (U3/U4): no ban/unban/purge, no throw', async () => {
            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).resolves.toBeUndefined();

            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockUnbanUser).not.toHaveBeenCalled();
            expect(mockPurgePrivateData).not.toHaveBeenCalled();
        });
    });

    describe('config guards', () => {
        it('missing DB_SECRET_ARN → fails fast before touching the DB', async () => {
            delete process.env.DB_SECRET_ARN;

            await expect(handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext())).rejects.toThrow();
            expect(mockGetDb).not.toHaveBeenCalled();
        });

        it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN → fails fast on the typed config', async () => {
            delete process.env.AUTH_SECRET_ARN;

            await expect(handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext())).rejects.toThrow();
            expect(mockGetDb).not.toHaveBeenCalled();
        });
    });
});
