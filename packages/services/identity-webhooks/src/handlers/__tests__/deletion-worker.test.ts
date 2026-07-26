/**
 * Deletion-worker unit tests (CR-002 / U4b). The worker routes deletion-queue records:
 *  - `closure`/`reactivation` → Clerk ban/unban (this Lambda holds the secret);
 *  - `erasure` (tombstone-sweep) → fan out recipe (first, R9) + food (R11);
 *  - no `event` (the `user.deleted` webhook, KTD-2) → full erasure: erase the identity to `{id}`
 *    (R10-covering `status='erased'`), then fan out. Idempotent throughout; a failed leg forces an SQS
 *    retry rather than a silent half-erasure (R7).
 */
import type { Context, SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindByIdentityId, mockEraseIdentityRow, mockRunErasureFanout } = vi.hoisted(() => ({
    mockFindByIdentityId: vi.fn(),
    mockEraseIdentityRow: vi.fn(),
    mockRunErasureFanout: vi.fn(),
}));

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));

vi.mock('@kitchensink/identity-db', () => {
    const UserDAO = vi.fn().mockImplementation(function () {
        return { findByIdentityId: mockFindByIdentityId };
    });

    return { UserDAO };
});

vi.mock('../../common/identityClient.js', () => ({
    banUser: vi.fn().mockResolvedValue(undefined),
    unbanUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../common/erase-identity.js', () => ({ eraseIdentityRow: mockEraseIdentityRow }));

vi.mock('../../common/erasure-fanout.js', () => ({ runErasureFanout: mockRunErasureFanout }));

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

const bothLegsOk = { recipe: { service: 'recipe', ok: true, jobStatus: 'queued' }, food: { service: 'food', ok: true, deletedRequesterRows: 1 } };

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
    mockEraseIdentityRow.mockResolvedValue(undefined);
    mockRunErasureFanout.mockResolvedValue(bothLegsOk);
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
    // Fan-out config (the fan-out itself is mocked, but getErasureFanoutConfig must resolve).
    process.env.SERVICE_ERASURE_SIGNING_KEY = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
    process.env.RECIPE_SERVICE_BASE_URL = 'https://recipe.example.test';
    process.env.FOOD_SERVICE_BASE_URL = 'https://food.example.test';
});

describe('deletion-worker handler', () => {
    describe('lifecycle routing (event field)', () => {
        it('closure → BANS the Clerk identity, never erases or fans out', async () => {
            await handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'closure' }), makeContext());

            expect(mockBanUser).toHaveBeenCalledWith('user_abc');
            expect(mockUnbanUser).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
        });

        it('reactivation → UNBANS the Clerk identity', async () => {
            await handler(
                makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'reactivation' }),
                makeContext(),
            );

            expect(mockUnbanUser).toHaveBeenCalledWith('user_abc');
            expect(mockBanUser).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });
    });

    describe('erasure event (tombstone-sweep) — fan out only (identity already scrubbed by the sweep)', () => {
        it('fans out to recipe + food keyed by the app ULID, actor = the sweep', async () => {
            await handler(
                makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure', enqueuedAt: '2026-07-26T00:00:00Z' }),
                makeContext(),
            );

            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
            const [target] = mockRunErasureFanout.mock.calls[0]!;
            expect(target).toMatchObject({ userId: 'usr_01', eventId: '2026-07-26T00:00:00Z', actor: 'identity-tombstone-sweep' });
            // The sweep already scrubbed the identity + deleted Clerk; the worker must NOT re-do those.
            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockBanUser).not.toHaveBeenCalled();
        });

        it('a failed leg THROWS so SQS redelivers (R7 — no silent half-erasure)', async () => {
            mockRunErasureFanout.mockResolvedValue({
                recipe: { service: 'recipe', ok: false, httpStatus: 503, detail: 'down' },
                food: { service: 'food', ok: true, deletedRequesterRows: 0 },
            });

            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).rejects.toThrow(/incomplete/i);
        });

        it('missing userId → cannot fan out, logs and no-ops (never a raw sub-keyed erase)', async () => {
            await handler(makeSqsEvent({ identityId: 'user_abc', event: 'erasure' }), makeContext());

            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });

        it('a missing fan-out env var fails LOUD (getErasureFanoutConfig throws → SQS retry)', async () => {
            delete process.env.SERVICE_ERASURE_SIGNING_KEY;
            resetConfigCacheForTests();

            await expect(
                handler(makeSqsEvent({ identityId: 'user_abc', userId: 'usr_01', event: 'erasure' }), makeContext()),
            ).rejects.toThrow();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
        });
    });

    describe('user.deleted webhook (no event) — KTD-2 full erasure', () => {
        it('existing active user → identity erased (status=erased, R10) then fanned out', async () => {
            mockFindByIdentityId.mockResolvedValue({ id: 'usr_01', identityId: 'user_abc', status: 'active' });

            await handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext());

            expect(mockEraseIdentityRow).toHaveBeenCalledTimes(1);
            const [, eraseInput] = mockEraseIdentityRow.mock.calls[0]!;
            expect(eraseInput).toMatchObject({ userId: 'usr_01', triggerSource: 'admin', actor: 'clerk-user-deleted-webhook' });
            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
            expect(mockRunErasureFanout.mock.calls[0]![0]).toMatchObject({ userId: 'usr_01' });
        });

        it('echo for an ALREADY-erased user → no second scrub/audit, but STILL fans out idempotently (R9)', async () => {
            mockFindByIdentityId.mockResolvedValue({ id: 'usr_01', identityId: 'user_abc', status: 'erased' });

            await handler(makeSqsEvent({ identityId: 'user_abc' }), makeContext());

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).toHaveBeenCalledTimes(1);
        });

        it('unknown identity → no erase, no fan-out, no throw (idempotent)', async () => {
            mockFindByIdentityId.mockResolvedValue(undefined);

            await expect(handler(makeSqsEvent({ identityId: 'user_nope' }), makeContext())).resolves.toBeUndefined();

            expect(mockEraseIdentityRow).not.toHaveBeenCalled();
            expect(mockRunErasureFanout).not.toHaveBeenCalled();
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
