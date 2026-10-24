import type { Context, ScheduledEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idpDeletionMessageSchema } from '@kitchensink/identity-core';

import { resetConfigCacheForTests } from '../../src/config/env.js';

/**
 * Integration (mocked dependencies): the scheduled erasure reconciliation, through its REAL handler, its REAL
 * producer (`enqueueErasure`) and the REAL deletion-message schema - with the database and the AWS SDK at the edge.
 *
 * It proves the seam the unit suite cannot: the message reconciliation puts on the queue is one the deletion worker
 * accepts, and an erased row whose Clerk deletion is unconfirmed makes NO HTTP call to recipe or food. Whether the
 * scan's SQL returns that row is the LOCAL e2e tier's claim (`tests/e2e/erasureProviderDeletion.e2e.test.ts`).
 *
 * @implements CR-002 R7
 */

const { sqsSend, mockRunErasureFanout } = vi.hoisted(() => ({ sqsSend: vi.fn(), mockRunErasureFanout: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof sqsSend }) {
        this.send = sqsSend;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

vi.mock('../../src/common/erasureFanout.js', () => ({ runErasureFanout: mockRunErasureFanout }));

const owedRow = { id: '01USER00000000000000000OWED', identityId: 'user_owed', providerDeletedAt: null };

vi.mock('../../src/common/db.js', () => ({
    getDb: vi.fn().mockResolvedValue({
        select: () => ({ from: () => ({ where: () => Promise.resolve([owedRow]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
}));

vi.mock('../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (e: T, c: unknown) => Promise<R>) => fn,
}));

const ctx = { getRemainingTimeInMillis: () => 25_000, awsRequestId: 'req-erasure-recon' } as unknown as Context;
const event = { id: 'sched', source: 'aws.events' } as unknown as ScheduledEvent;

type Result = { scanned: number; incomplete: number };

beforeEach(() => {
    resetConfigCacheForTests();
    process.env['DB_HOST'] = 'db.internal';
    process.env['DB_PORT'] = '5432';
    process.env['DB_NAME'] = 'kitchensink_identity';
    process.env['AUTH_SECRET_ARN'] = 'sk_test_dummy';
    process.env['DELETION_QUEUE_URL'] = 'https://sqs.local/queue/deletion';
    process.env['SERVICE_ERASURE_SIGNING_KEY'] = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
    process.env['RECIPE_SERVICE_BASE_URL'] = 'https://recipe.example.test';
    process.env['FOOD_SERVICE_BASE_URL'] = 'https://food.example.test';
    sqsSend.mockResolvedValue({});
});

afterEach(() => vi.clearAllMocks());

describe('integration: erasure reconciliation with a Clerk deletion still owed', () => {
    it('sends ONE erasure message the deletion worker accepts, and makes no recipe/food call', async () => {
        const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
        const { handler } = await import('../../src/handlers/erasureReconciliation.js');

        const result = (await (handler as unknown as (e: ScheduledEvent, c: Context) => Promise<Result>)(
            event,
            ctx,
        )) as Result;

        expect(result).toEqual({ scanned: 1, incomplete: 1 });
        expect(sqsSend).toHaveBeenCalledTimes(1);

        const input = vi.mocked(SendMessageCommand).mock.calls[0]![0]!;
        expect(input.QueueUrl).toBe('https://sqs.local/queue/deletion');
        expect(idpDeletionMessageSchema.parse(JSON.parse(input.MessageBody as string))).toMatchObject({
            event: 'erasure',
            identityId: 'user_owed',
            userId: '01USER00000000000000000OWED',
        });

        // Fanning out now would destroy data behind an account that may still sign in.
        expect(mockRunErasureFanout).not.toHaveBeenCalled();
    });
});
