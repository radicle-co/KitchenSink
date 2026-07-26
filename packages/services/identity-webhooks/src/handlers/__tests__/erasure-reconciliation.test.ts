/**
 * Unit tests for the erasure-reconciliation sweep (CR-002 / U4b / R7 — the completion contract's detective
 * + corrective control). It scans identity `status='erased'` rows past a grace window and, for each,
 * re-drives the idempotent recipe + food erasure legs (correlation key = the owner ULID across the two
 * DBs). A leg that is non-terminal, reports residual work, or errors is an "erasure incomplete" signal:
 * the sweep both HEALS it (the re-drive is idempotent) and counts it into the `ErasureIncomplete` metric
 * the alarm watches. A fully-complete erasure re-drives to two no-ops and is not flagged.
 */
import type { Context, ScheduledEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunErasureFanout } = vi.hoisted(() => ({ mockRunErasureFanout: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getDb: vi.fn() }));

vi.mock('@kitchensink/identity-db', () => ({ UserDAO: vi.fn(), users: { id: 'id', identityId: 'identity_id', status: 'status', updatedAt: 'updated_at' } }));

vi.mock('drizzle-orm', () => ({
    and: (...a: unknown[]) => ({ and: a }),
    eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
    lte: (c: unknown, v: unknown) => ({ lte: [c, v] }),
}));

vi.mock('../../common/erasure-fanout.js', () => ({ runErasureFanout: mockRunErasureFanout }));

const { emitMetric } = vi.hoisted(() => ({ emitMetric: vi.fn() }));
vi.mock('../../common/observability.js', () => ({
    emitMetric,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { handler as rawHandler } from '../erasure-reconciliation.js';
import { getDb } from '../../common/db.js';
import { resetConfigCacheForTests } from '../../config/env.js';

type Result = { scanned: number; incomplete: number };
type TestHandler = (event: ScheduledEvent, ctx: Context) => Promise<Result>;
const handler = rawHandler as unknown as TestHandler;

const mockGetDb = vi.mocked(getDb);

const makeContext = (): Context => ({ awsRequestId: 'req' }) as unknown as Context;
const makeEvent = (): ScheduledEvent => ({ id: 's', source: 'aws.events' }) as unknown as ScheduledEvent;

/** A db whose `select…from…where` resolves the given erased rows. */
const mockDbWith = (rows: Array<{ id: string; identityId: string }>) => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
});

const complete = { recipe: { service: 'recipe', ok: true, jobStatus: 'completed' }, food: { service: 'food', ok: true, deletedRequesterRows: 0 } };

beforeEach(() => {
    vi.clearAllMocks();
    resetConfigCacheForTests();
    mockRunErasureFanout.mockResolvedValue(complete);
    process.env.DB_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
    process.env.AUTH_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
    process.env.SERVICE_ERASURE_SIGNING_KEY = 'k';
    process.env.RECIPE_SERVICE_BASE_URL = 'https://recipe.example.test';
    process.env.FOOD_SERVICE_BASE_URL = 'https://food.example.test';
});

describe('erasure-reconciliation handler', () => {
    it('re-drives every erased user (actor = reconciliation) and flags none when both legs are terminal/clean', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([{ id: 'usr_01', identityId: 'user_a' }, { id: 'usr_02', identityId: 'user_b' }]) as never);

        const result = await handler(makeEvent(), makeContext());

        expect(mockRunErasureFanout).toHaveBeenCalledTimes(2);
        expect(mockRunErasureFanout.mock.calls[0]![0]).toMatchObject({ userId: 'usr_01', actor: 'erasure-reconciliation' });
        expect(result).toMatchObject({ scanned: 2, incomplete: 0 });
        expect(emitMetric).toHaveBeenCalledWith('ErasureIncomplete', 0);
    });

    it('flags a recipe leg that is NOT terminal (queued/running) as incomplete', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([{ id: 'usr_01', identityId: 'user_a' }]) as never);
        mockRunErasureFanout.mockResolvedValue({
            recipe: { service: 'recipe', ok: true, jobStatus: 'running' },
            food: { service: 'food', ok: true, deletedRequesterRows: 0 },
        });

        const result = await handler(makeEvent(), makeContext());

        expect(result).toMatchObject({ scanned: 1, incomplete: 1 });
        expect(emitMetric).toHaveBeenCalledWith('ErasureIncomplete', 1);
    });

    it('flags a food leg that still had residue (rows deleted > 0) — it was incomplete, now healed', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([{ id: 'usr_01', identityId: 'user_a' }]) as never);
        mockRunErasureFanout.mockResolvedValue({
            recipe: { service: 'recipe', ok: true, jobStatus: 'completed' },
            food: { service: 'food', ok: true, deletedRequesterRows: 3 },
        });

        const result = await handler(makeEvent(), makeContext());

        expect(result).toMatchObject({ scanned: 1, incomplete: 1 });
    });

    it('flags a leg that could not be reached (ok=false) as incomplete', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([{ id: 'usr_01', identityId: 'user_a' }]) as never);
        mockRunErasureFanout.mockResolvedValue({
            recipe: { service: 'recipe', ok: false, httpStatus: 503 },
            food: { service: 'food', ok: true, deletedRequesterRows: 0 },
        });

        const result = await handler(makeEvent(), makeContext());

        expect(result).toMatchObject({ scanned: 1, incomplete: 1 });
    });

    it('no erased users → scans nothing, flags nothing', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([]) as never);

        const result = await handler(makeEvent(), makeContext());

        expect(mockRunErasureFanout).not.toHaveBeenCalled();
        expect(result).toMatchObject({ scanned: 0, incomplete: 0 });
        expect(emitMetric).toHaveBeenCalledWith('ErasureIncomplete', 0);
    });

    it('one user erroring does NOT abort the batch (the rest are still reconciled)', async () => {
        mockGetDb.mockResolvedValue(mockDbWith([{ id: 'usr_01', identityId: 'user_a' }, { id: 'usr_02', identityId: 'user_b' }]) as never);
        mockRunErasureFanout.mockImplementation((target: { userId: string }) =>
            target.userId === 'usr_01' ? Promise.reject(new Error('boom')) : Promise.resolve(complete),
        );

        const result = await handler(makeEvent(), makeContext());

        // usr_01 errored (counted incomplete), usr_02 still reconciled cleanly.
        expect(mockRunErasureFanout).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ scanned: 2, incomplete: 1 });
    });
});
