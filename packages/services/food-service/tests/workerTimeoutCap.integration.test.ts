/**
 * Integration (mocked, CODING_STANDARDS §7.1a): a source that keeps timing out on one food does not defer it for ever.
 * The real `FoodConsumerService`, `FetchQueueDao` and `RollingWindowLimiter` run over a pool that never connects; the
 * queue's settle methods and the food store are doubles, so a path that reaches further fails on the connection.
 *
 * - a timeout (`statusCode 0`) counts against the row's own timeout budget and defers it, spending no failure attempt;
 * - the timeout that reaches the cap fails the row through the existing failure path (`FAILED` tombstone), and does not
 *   defer it again;
 * - a gateway backpressure answer defers WITHOUT counting, because it is not a timeout.
 *
 * What the row then holds in a real table, and what the queue watcher reports for it, is the LOCAL e2e tier's
 * (`tests/e2e/foodConsumer.e2e.test.ts`, `tests/e2e/queueCheck.e2e.test.ts`).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../src/db/schema/index.js';
import type { FetchQueueRow, FoodRow } from '../src/db/schema/index.js';
import { FetchQueueDao, type ClaimedFetchQueueRow } from '../src/foods/dao/fetchQueue.dao.js';
import { FoodDao, type SetStatusInput } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { leaseFenceFrom, type SettleAuthority } from '../src/foods/dao/leaseFence.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../src/foods/merge/mergeAndPersist.service.js';
import { SourceApiError } from '../src/sources/foodSource.errors.js';
import type { CanonicalCandidate, SourceCandidate } from '../src/sources/foodSourceAdapter.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import { MAX_TIMEOUT_DEFERRALS } from '../src/worker/backoff.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { makeFoodRow } from './__fixtures__/foodRow.js';
import { admittingAdapter } from './support/admittingAdapter.js';
import { countingLedger } from './support/countingLedger.js';

const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const FOOD = makeFoodRow();

/** A database with no client: a DAO method this suite did not replace fails on its first query. */
const db = drizzle.mock({ schema });

/** The row `leaseNext` hands the consumer. */
function claimedRow(): ClaimedFetchQueueRow {
    const at = new Date('2026-10-02T12:00:00.000Z');

    return {
        foodId: FOOD.id,
        requestCount: 1,
        firstRequested: at,
        lastRequested: at,
        status: 'in_flight',
        attempts: 2,
        timeoutCount: 0,
        lastError: null,
        fetchedAt: null,
        leasedAt: at,
        fence: leaseFenceFrom('2026-10-02 12:00:00.000000+00'),
    };
}

/**
 * The worker over a source that answers every search with `error`, and a queue whose timeout settle reports
 * `timeoutCount` after the increment.
 *
 * @param error - What the source throws.
 * @param timeoutCount - The count the queue reports for the row after this timeout.
 * @returns The consumer and the doubles a case asserts on.
 */
function workerOver(error: Error, timeoutCount: number) {
    const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
    const usda = {
        source: 'usda' as const,
        searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => {
            throw error;
        }),
        fetchByKey: vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(),
    };
    const registry = new SourceAdapterRegistry();
    registry.register(
        admittingAdapter(usda, {
            admission: new RollingWindowLimiter(countingLedger([], clock), {}),
            blocks: { record: async () => undefined },
        }),
    );
    const deferLease = vi.fn<(foodId: string, seconds: number, authority: SettleAuthority) => Promise<void>>(
        async () => undefined,
    );
    const deferTimeout = vi.fn<(foodId: string, seconds: number, authority: SettleAuthority) => Promise<FetchQueueRow>>(
        async () => ({ ...claimedRow(), status: 'pending', leasedAt: null, timeoutCount }),
    );
    const recordFailure = vi.fn(async () => {
        throw new Error('a timeout is not a real failure: it must not spend an attempt');
    });
    const tombstone = vi.fn<
        (foodId: string, lastError: string | undefined, authority: SettleAuthority) => Promise<void>
    >(async () => undefined);
    const queue = Object.assign(new FetchQueueDao(db, { demoteThreshold: 50, leaseSeconds: 30 }), {
        leaseNext: async (): Promise<ClaimedFetchQueueRow | undefined> => claimedRow(),
        listRequesterIds: async (): Promise<string[]> => [REQUESTER],
        deferLease,
        deferTimeout,
        recordFailure,
        tombstone,
    });
    const setStatus = vi.fn(async (input: SetStatusInput): Promise<FoodRow> => ({ ...FOOD, status: input.status }));
    const foodDao = Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), {
        getById: async (id: string): Promise<FoodRow | undefined> => (id === FOOD.id ? FOOD : undefined),
        setStatus,
    });
    const publishFetchFailed = vi.fn(async () => undefined);
    const consumer = new FoodConsumerService({
        foodDao,
        sources: new FoodSourcesDao(db),
        queue,
        registry,
        merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        catalog: {
            names: { identicalEntryFor: async () => undefined },
            owners: {
                standingOfKeys: async () => ({ owners: new Map(), retired: new Set() }),
                standingOfItems: async () => new Map(),
            },
        },
        events: { publishFoodFetchCompleted: async () => undefined, publishFetchFailed },
        logger: new SilentWorkerLogger(),
    });

    return { consumer, deferLease, deferTimeout, recordFailure, tombstone, setStatus, publishFetchFailed };
}

describe('a source timeout is deferred only up to its own budget (mocked)', () => {
    it('counts the timeout against the row and defers it, spending no failure attempt', async () => {
        const worker = workerOver(new SourceApiError('usda', 0, 'USDA request timed out'), 1);

        await expect(worker.consumer.processNext()).resolves.toBe('deferred');

        expect(worker.deferTimeout).toHaveBeenCalledTimes(1);
        expect(worker.deferLease).not.toHaveBeenCalled();
        expect(worker.recordFailure).not.toHaveBeenCalled();
        expect(worker.tombstone).not.toHaveBeenCalled();
    });

    it('still defers the timeout one short of the cap', async () => {
        const worker = workerOver(new SourceApiError('usda', 0, 'timed out'), MAX_TIMEOUT_DEFERRALS - 1);

        await expect(worker.consumer.processNext()).resolves.toBe('deferred');

        expect(worker.tombstone).not.toHaveBeenCalled();
    });

    it('fails the row through the existing failure path when the timeout reaches the cap', async () => {
        const worker = workerOver(new SourceApiError('usda', 0, 'timed out'), MAX_TIMEOUT_DEFERRALS);

        await expect(worker.consumer.processNext()).resolves.toBe('failed');

        expect(worker.setStatus).toHaveBeenCalledWith({ id: FOOD.id, status: 'FAILED' });
        expect(worker.tombstone).toHaveBeenCalledWith(FOOD.id, 'source_timeout', 'out-of-band');
        expect(worker.publishFetchFailed).toHaveBeenCalledWith({
            id: FOOD.id,
            attempts: 2,
            lastError: 'source_timeout',
        });
    });

    it('does not count a gateway backpressure answer as a timeout', async () => {
        const worker = workerOver(new SourceApiError('usda', 503, 'gateway'), MAX_TIMEOUT_DEFERRALS);

        await expect(worker.consumer.processNext()).resolves.toBe('deferred');

        expect(worker.deferTimeout).not.toHaveBeenCalled();
        expect(worker.deferLease).toHaveBeenCalledTimes(1);
        expect(worker.tombstone).not.toHaveBeenCalled();
    });
});
