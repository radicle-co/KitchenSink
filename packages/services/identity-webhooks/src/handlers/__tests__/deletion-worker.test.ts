import type { Context, SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../common/db.js', () => ({
    getDb: vi.fn(),
}));

const mockHardDeleteByIdentityId = vi.fn();
const mockFindByIdentityId = vi.fn();

vi.mock('@kitchensink/identity-service/database/dao', () => {
    const UserDAO = vi.fn().mockImplementation(function () {
        return {
            findByIdentityId: mockFindByIdentityId,
            hardDeleteByIdentityId: mockHardDeleteByIdentityId,
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
    mockGetDb.mockResolvedValue({} as never);
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
});

describe('deletion-worker handler', () => {
    it('existing user → hard-deleted, no error thrown', async () => {
        const identityId = 'user_abc123';
        const userRow = { id: 'usr_01', identityId, email: 'test@example.com', deletedAt: null };

        mockFindByIdentityId.mockResolvedValue(userRow);
        mockHardDeleteByIdentityId.mockResolvedValue(userRow);

        await expect(handler(makeSqsEvent(identityId), makeContext())).resolves.toBeUndefined();

        expect(mockFindByIdentityId).toHaveBeenCalledWith(identityId);
        expect(mockHardDeleteByIdentityId).toHaveBeenCalledWith(identityId);
    });

    it('missing user → no error thrown (idempotent)', async () => {
        const identityId = 'user_nonexistent';

        mockFindByIdentityId.mockResolvedValue(undefined);

        await expect(handler(makeSqsEvent(identityId), makeContext())).resolves.toBeUndefined();

        expect(mockFindByIdentityId).toHaveBeenCalledWith(identityId);
        expect(mockHardDeleteByIdentityId).not.toHaveBeenCalled();
    });

    it('missing DB_SECRET_ARN → throws', async () => {
        delete process.env.DB_SECRET_ARN;

        await expect(handler(makeSqsEvent('user_abc'), makeContext())).rejects.toThrow();
    });
});
