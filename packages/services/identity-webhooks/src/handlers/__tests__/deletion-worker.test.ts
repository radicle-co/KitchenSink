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

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../deletion-worker.js';
import { getDb } from '../../common/db.js';
import { resetConfigCacheForTests } from '../../config/env.js';

type TestHandler = (event: SQSEvent, ctx: Context) => Promise<void>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);

const makeContext = (): Context => ({ awsRequestId: 'test-req-id' }) as unknown as Context;

const makeSqsEvent = (identityId: string): SQSEvent => ({
    Records: [
        {
            messageId: 'msg-1',
            receiptHandle: 'receipt-1',
            body: JSON.stringify({ identityId }),
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
    // The real deletion-worker Lambda's env always carries AUTH_SECRET_ARN (part of the CDK stack's
    // shared commonEnv), even though this handler's own code never reads it — the schema's
    // IDP_SECRET_KEY/AUTH_SECRET_ARN refine reflects that real, always-present surface.
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
});

describe('deletion-worker handler', () => {
    it('existing user → private data purged, no error thrown', async () => {
        const identityId = 'user_abc123';
        // The purge keeps the soft-deleted user row (id/email/name) and returns it.
        const userRow = { id: 'usr_01', identityId, email: 'test@example.com', deletedAt: new Date(), picture: null };

        mockPurgePrivateData.mockResolvedValue(userRow);

        await expect(handler(makeSqsEvent(identityId), makeContext())).resolves.toBeUndefined();

        expect(mockPurgePrivateData).toHaveBeenCalledWith(identityId);
        // Reads DB_SECRET_ARN from the typed config (getConfig()), not a hand-rolled requireEnv lookup.
        expect(mockGetDb).toHaveBeenCalledWith('arn:aws:secretsmanager:us-east-1:123:secret:db');
    });

    it('missing user → no error thrown (idempotent)', async () => {
        const identityId = 'user_nonexistent';

        mockPurgePrivateData.mockResolvedValue(undefined);

        await expect(handler(makeSqsEvent(identityId), makeContext())).resolves.toBeUndefined();

        expect(mockPurgePrivateData).toHaveBeenCalledWith(identityId);
    });

    it('missing DB_SECRET_ARN → fails fast on the typed config before touching the DB', async () => {
        delete process.env.DB_SECRET_ARN;

        await expect(handler(makeSqsEvent('user_abc'), makeContext())).rejects.toThrow();
        expect(mockGetDb).not.toHaveBeenCalled();
    });

    it('missing both IDP_SECRET_KEY and AUTH_SECRET_ARN → fails fast on the typed config', async () => {
        delete process.env.AUTH_SECRET_ARN;

        await expect(handler(makeSqsEvent('user_abc'), makeContext())).rejects.toThrow();
        expect(mockGetDb).not.toHaveBeenCalled();
    });
});
