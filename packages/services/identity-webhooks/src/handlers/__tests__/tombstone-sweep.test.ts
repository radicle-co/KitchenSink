/**
 * Tombstone-sweep unit tests (CR-002 KTD-3): the scheduled 12-month tombstone → erasure sweep. Finds
 * tombstoned rows whose closure is ≥ 12 months old and transitions each to erasure — erased-scrub the identity
 * to {id}, Clerk `deleteUser`, append the R8 audit row, and enqueue the recipe/food erasure legs (U3/U4 seam).
 */
import type { Context, ScheduledEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqsSend } = vi.hoisted(() => ({ sqsSend: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));

vi.mock('../../common/identityClient.js', () => ({ deleteUser: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof sqsSend }) {
        this.send = sqsSend;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

vi.mock('../../common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler, erasureCutoff, TOMBSTONE_ERASURE_MONTHS } from '../tombstone-sweep.js';
import { getDb } from '../../common/db.js';
import { deleteUser } from '../../common/identityClient.js';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { resetConfigCacheForTests } from '../../config/env.js';

type TestHandler = (event: ScheduledEvent, ctx: Context) => Promise<{ scanned: number; erased: number }>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);
const mockDeleteUser = vi.mocked(deleteUser);

const makeContext = (): Context => ({ awsRequestId: 'req' }) as unknown as Context;
const makeEvent = (): ScheduledEvent => ({ id: 'sched', source: 'aws.events' }) as unknown as ScheduledEvent;

/** A drizzle-shaped mock db whose `select…where` resolves the given expired-tombstone rows. */
function buildMockDb(expired: Array<{ id: string; identityId: string }>) {
    const userSets: Array<Record<string, unknown>> = [];
    const deletedTables: string[] = [];
    const auditRows: Array<Record<string, unknown>> = [];

    const tx = {
        update: () => ({
            set: (value: Record<string, unknown>) => {
                userSets.push(value);

                return { where: () => Promise.resolve() };
            },
        }),
        delete: (table: { __t?: string }) => {
            deletedTables.push(table?.__t ?? 'unknown');

            return { where: () => Promise.resolve() };
        },
        insert: () => ({
            values: (value: Record<string, unknown>) => {
                auditRows.push(value);

                return Promise.resolve();
            },
        }),
    };

    const db = {
        select: () => ({ from: () => ({ where: () => Promise.resolve(expired) }) }),
        transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
    };

    return { db, userSets, deletedTables, auditRows };
}

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
    process.env.IDP_SECRET_KEY = 'sk_test_abc';
    process.env.DELETION_QUEUE_URL = 'https://sqs.local/queue/deletion';
    mockDeleteUser.mockResolvedValue(undefined);
});

describe('erasureCutoff', () => {
    it('uses a 12-month retention window', () => {
        expect(TOMBSTONE_ERASURE_MONTHS).toBe(12);
    });

    it('subtracts 12 months from the reference instant', () => {
        expect(erasureCutoff(new Date('2026-07-25T00:00:00.000Z')).toISOString()).toBe('2025-07-25T00:00:00.000Z');
    });
});

describe('tombstone-sweep handler', () => {
    it('erases each expired tombstone: scrub → {id}, Clerk delete, audit row, enqueue legs', async () => {
        const { db, userSets, deletedTables, auditRows } = buildMockDb([{ id: 'usr_01', identityId: 'user_a' }]);
        mockGetDb.mockResolvedValue(db as never);

        const result = await handler(makeEvent(), makeContext());

        // Identity scrubbed to the erased state: name destroyed, email → placeholder, status erased.
        expect(userSets[0]).toMatchObject({ status: 'erased', name: null, picture: null });
        expect(userSets[0]!.email).toContain('@erased.invalid');
        // Companion rows purged (accounts + profiles).
        expect(deletedTables).toHaveLength(2);
        // Clerk identity DELETED (erasure deletes; closure only bans).
        expect(mockDeleteUser).toHaveBeenCalledWith('user_a');
        // R8 audit row for the automated sweep.
        expect(auditRows[0]).toMatchObject({ event: 'erasure', triggerSource: 'sweep', userId: 'usr_01' });
        // Recipe/food erasure legs enqueued via the existing deletion path (U3/U4 seam consumer).
        const body = JSON.parse(vi.mocked(SendMessageCommand).mock.calls[0]![0]!.MessageBody as string);
        expect(body).toMatchObject({ identityId: 'user_a', userId: 'usr_01', event: 'erasure' });

        expect(result).toMatchObject({ scanned: 1, erased: 1 });
    });

    it('no expired tombstones → no Clerk delete, no enqueue (idempotent no-op)', async () => {
        const { db } = buildMockDb([]);
        mockGetDb.mockResolvedValue(db as never);

        const result = await handler(makeEvent(), makeContext());

        expect(mockDeleteUser).not.toHaveBeenCalled();
        expect(sqsSend).not.toHaveBeenCalled();
        expect(result).toMatchObject({ scanned: 0, erased: 0 });
    });

    it('a Clerk delete failure for one user does NOT abort the run (the DB scrub is skipped, retried next run)', async () => {
        const { db, auditRows } = buildMockDb([
            { id: 'usr_01', identityId: 'user_a' },
            { id: 'usr_02', identityId: 'user_b' },
        ]);
        mockGetDb.mockResolvedValue(db as never);
        mockDeleteUser.mockImplementation((id: string) =>
            id === 'user_a' ? Promise.reject(new Error('clerk 500')) : Promise.resolve(),
        );

        const result = await handler(makeEvent(), makeContext());

        // user_b still erased despite user_a's Clerk failure; user_a left for the next run (not scrubbed).
        expect(result).toMatchObject({ scanned: 2, erased: 1 });
        expect(auditRows).toHaveLength(1);
        expect(auditRows[0]).toMatchObject({ userId: 'usr_02' });
    });
});
