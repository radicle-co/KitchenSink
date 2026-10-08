/**
 * Integration (mocked, CODING_STANDARDS §7.1a): the worker's share of the source window, through the composition the
 * worker runs — the real `FoodConsumerService`, the real `RollingWindowLimiter` and the real rate-limited transport
 * (`admittingAdapter`) — with the call ledger, the queue and the food store as doubles. No database is reached: the
 * DAOs are built over a pool that never connects, and each double replaces only the methods the drain path calls, so
 * a path that reaches further fails on the connection instead of passing over a stub.
 *
 * It pins what only the composition can show (owner, 2026-10-02; `WORKER_WINDOW_SHARE` in `sourceCeiling.ts`):
 *
 * - a worker at its share defers the row exactly as a full window defers it: the same delay, no attempt spent, and
 *   the source never asked;
 * - on that same window, a live call is still admitted and reaches the source;
 * - live calls do not count toward the worker's share: a window they fill past it still lets the worker ask.
 *
 * What the queue row then holds in a real table, and two consumers racing one window, is the LOCAL e2e tier's
 * (`tests/e2e/workerSourceShare.e2e.test.ts`).
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
import type { CanonicalCandidate, SourceCandidate } from '../src/sources/foodSourceAdapter.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import { sourceCeiling, workerCeiling } from '../src/sources/transport/sourceCeiling.js';
import { apiAccessOf } from '../src/sources/sourceRegister.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { makeFoodRow } from './__fixtures__/foodRow.js';
import { admittingAdapter } from './support/admittingAdapter.js';
import { callsOn, countingLedger, type LedgerCall, type TestClock } from './support/countingLedger.js';

/** A real principal, so the provenance check admits the row before any source call. */
const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** The food the leased row is for. */
const FOOD = makeFoodRow();

/** USDA's admission ceiling and the worker's share of it, from the declared limit (no override in this suite). */
const CEILING = sourceCeiling(apiAccessOf('usda').rateLimit.requests);
const WORKER_CEILING = workerCeiling(CEILING);

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
        attempts: 0,
        lastError: null,
        fetchedAt: null,
        leasedAt: at,
        fence: leaseFenceFrom('2026-10-02 12:00:00.000000+00'),
    };
}

/** A USDA double that has nothing for any name, so an admitted fan-out ends at one search. */
function usdaDouble() {
    return {
        source: 'usda' as const,
        searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => []),
        fetchByKey: vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(),
    };
}

/**
 * The worker over a window already holding `calls`: the real consumer, limiter and transport on the worker lane, with
 * the queue and food store doubled.
 *
 * @param calls - The calls in the window before the drain.
 * @param clock - The ledger's clock.
 * @returns The consumer, the queue's recorded settles, and the USDA double.
 */
function workerOver(calls: LedgerCall[], clock: TestClock) {
    const usda = usdaDouble();
    const limiter = new RollingWindowLimiter(countingLedger(calls, clock), {});
    const registry = new SourceAdapterRegistry();
    registry.register(admittingAdapter(usda, { admission: limiter, blocks: { record: async () => undefined } }));

    const deferLease = vi.fn<(foodId: string, seconds: number, authority: SettleAuthority) => Promise<void>>(
        async () => undefined,
    );
    const recordFailure = vi.fn<
        (foodId: string, lastError: string | undefined, authority: SettleAuthority) => Promise<FetchQueueRow>
    >(async () => {
        throw new Error('recordFailure spends an attempt, and a refused call is not a failure');
    });
    const tombstone = vi.fn<
        (foodId: string, lastError: string | undefined, authority: SettleAuthority) => Promise<void>
    >(async () => undefined);
    const queue = Object.assign(new FetchQueueDao(db, { demoteThreshold: 50, leaseSeconds: 30 }), {
        leaseNext: async (): Promise<ClaimedFetchQueueRow | undefined> => claimedRow(),
        listRequesterIds: async (): Promise<string[]> => [REQUESTER],
        deferLease,
        recordFailure,
        tombstone,
    });
    const foodDao = Object.assign(new FoodDao(db, { notFoundTtlDays: 30 }), {
        getById: async (id: string): Promise<FoodRow | undefined> => (id === FOOD.id ? FOOD : undefined),
        setStatus: async (input: SetStatusInput): Promise<FoodRow> => ({ ...FOOD, status: input.status }),
    });
    const consumer = new FoodConsumerService({
        foodDao,
        sources: new FoodSourcesDao(db),
        queue,
        registry,
        merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        // The catalog holds nothing here, so every case reaches the source window it is about.
        catalog: {
            names: { identicalEntryFor: async () => undefined },
            owners: {
                standingOfKeys: async () => ({ owners: new Map(), retired: new Set() }),
                standingOfItems: async () => new Map(),
            },
        },
        events: { publishFoodFetchCompleted: async () => undefined, publishFetchFailed: async () => undefined },
        logger: new SilentWorkerLogger(),
    });

    return { consumer, deferLease, recordFailure, tombstone, usda, limiter };
}

describe('the worker spends at most its share of the source window (mocked)', () => {
    it('defers the row at its share exactly as a full window defers it: no attempt, the source never asked', async () => {
        const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
        const atShare = workerOver(callsOn(WORKER_CEILING, 'worker', clock), clock);
        const fullWindow = workerOver(callsOn(CEILING, 'worker', clock), clock);

        await expect(atShare.consumer.processNext()).resolves.toBe('deferred');
        await expect(fullWindow.consumer.processNext()).resolves.toBe('deferred');

        expect(atShare.usda.searchByName).not.toHaveBeenCalled();
        expect(atShare.recordFailure).not.toHaveBeenCalled();
        expect(atShare.deferLease).toHaveBeenCalledTimes(1);
        expect(atShare.deferLease.mock.calls[0]).toEqual(fullWindow.deferLease.mock.calls[0]);
        expect(atShare.deferLease.mock.calls[0]?.[1]).toBeGreaterThan(0);
    });

    // The positive control: the same harness one call under the share asks the source, so the deferral above is the
    // share's and not the harness's.
    it('asks the source and settles the row while the window is one call under the worker’s share', async () => {
        const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
        const worker = workerOver(callsOn(WORKER_CEILING - 1, 'worker', clock), clock);

        await expect(worker.consumer.processNext()).resolves.toBe('not_found');

        expect(worker.usda.searchByName).toHaveBeenCalledWith(FOOD.normalizedName);
        expect(worker.tombstone).toHaveBeenCalledTimes(1);
        expect(worker.deferLease).not.toHaveBeenCalled();
    });

    it('still asks the source when live calls alone fill the window past the worker’s share', async () => {
        const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
        const worker = workerOver(callsOn(WORKER_CEILING, 'interactive', clock), clock);

        await expect(worker.consumer.processNext()).resolves.toBe('not_found');

        expect(worker.usda.searchByName).toHaveBeenCalledWith(FOOD.normalizedName);
        expect(worker.deferLease).not.toHaveBeenCalled();
    });

    it('still admits a live call on the window where the worker stopped, and that call reaches the source', async () => {
        const clock = { now: Date.parse('2026-10-02T12:00:00.000Z') };
        const calls = callsOn(WORKER_CEILING, 'worker', clock);
        const worker = workerOver(calls, clock);
        const live = usdaDouble();
        const liveAdapter = admittingAdapter(
            live,
            { admission: worker.limiter, blocks: { record: async () => undefined } },
            'interactive',
        );

        await expect(worker.consumer.processNext()).resolves.toBe('deferred');
        await expect(liveAdapter.searchByName('broccoli')).resolves.toEqual([]);

        expect(live.searchByName).toHaveBeenCalledWith('broccoli');
        expect(calls.filter((call) => call.lane === 'interactive')).toHaveLength(1);
    });
});
