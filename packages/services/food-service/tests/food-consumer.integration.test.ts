/**
 * Integration suite for the Phase-5 fan-out/merge worker (T-150..T-155, T-165) over REAL Postgres with
 * MOCKED source adapters + a fake event bus. Exercises the full enqueue → lease → fan-out → batch
 * fetch → merge → RESOLVED → row-deleted → FoodFetchCompleted flow, plus NOT_FOUND, the 5xx
 * backoff→FAILED budget, the 90% limiter pause, the lease reaper, the per-key fallback, and the
 * single-drainer advisory lock (TST-7). No real network/AWS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type pg from 'pg';

import { FoodEventEmitter, type EventBus, type EventBusPutInput } from '../src/events/food-event-emitter.js';
import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/source-call-log.dao.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/merge-engine.js';
import { MergeAndPersistService } from '../src/foods/merge/merge-and-persist.service.js';
import {
    SourceAdapterRegistry,
    SourceApiError,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/food-source-adapter.js';
import { RollingWindowLimiter, type SourceCap } from '../src/sources/rolling-window-limiter.js';
import { FoodConsumerService } from '../src/worker/food-consumer.service.js';
import { SilentWorkerLogger } from '../src/worker/worker-logger.js';
import { acquireWorkerLock } from '../src/worker/worker-lock.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** A fake USDA adapter whose methods are vitest mocks. */
type FakeUsdaAdapter = FoodSourceAdapter & {
    searchByName: Mock<(name: string) => Promise<SourceCandidate[]>>;
    fetchByKey: Mock<(externalKey: string) => Promise<CanonicalCandidate>>;
    fetchByKeys: Mock<(externalKeys: readonly string[]) => Promise<CanonicalCandidate[]>>;
};

/** Build a fresh fake USDA adapter (batch-capable). */
function makeFakeUsdaAdapter(): FakeUsdaAdapter {
    return {
        source: 'usda',
        searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => []),
        fetchByKey: vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(),
        fetchByKeys: vi.fn<(externalKeys: readonly string[]) => Promise<CanonicalCandidate[]>>(),
    };
}

describe.skipIf(!DATABASE_URL)('FoodConsumerService (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** Wire a fresh consumer around the given adapter + optional limiter caps; capture emitted events. */
    function build(
        adapter: FoodSourceAdapter,
        caps?: Partial<Record<'usda', SourceCap>>,
    ): { consumer: FoodConsumerService; puts: EventBusPutInput[] } {
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const limiter = new RollingWindowLimiter(new SourceCallLogDao(db), caps ? { caps } : undefined);
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry));
        const puts: EventBusPutInput[] = [];
        const bus: EventBus = {
            putEvent: async (input) => {
                puts.push(input);
            },
        };
        const consumer = new FoodConsumerService({
            foodDao,
            queue,
            registry,
            limiter,
            merge,
            events: new FoodEventEmitter(bus),
            logger: new SilentWorkerLogger(),
        });

        return { consumer, puts };
    }

    /** Enqueue a freshly created PENDING food with one requester. */
    async function enqueueFood(normalizedName: string, displayName?: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: displayName ?? normalizedName });
        await requesters.add({ foodId: id, sub: 'user_a' });
        await queue.enqueue(id);

        return id;
    }

    it('drains a PENDING food: fan-out → ≤20-key BATCH → merge → RESOLVED → row deleted → FoodFetchCompleted (1 windowed call)', async () => {
        const id = await enqueueFood('broccoli, raw', 'Broccoli, raw');

        const hits: SourceCandidate[] = [
            { source: 'usda', externalKey: '171688', name: 'Broccoli, raw' },
            { source: 'usda', externalKey: '170379', name: 'Broccoli, raw' },
        ];
        const candidates: CanonicalCandidate[] = [
            makeMergeCandidate('usda', {
                externalKey: '171688',
                name: 'Broccoli, raw',
                description: 'raw broccoli',
                nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.8', basis: 'per_100g' }],
                portions: [{ label: '1 cup', gramWeight: '91' }],
            }),
            makeMergeCandidate('usda', { externalKey: '170379', name: 'Broccoli, raw' }),
        ];
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockResolvedValue(hits);
        adapter.fetchByKeys.mockResolvedValue(candidates);
        const { consumer, puts } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('resolved');
        // T-155: a single ≤20-key batch call, NOT one fetchByKey per hit.
        expect(adapter.fetchByKeys).toHaveBeenCalledTimes(1);
        expect(adapter.fetchByKeys).toHaveBeenCalledWith(['171688', '170379']);
        expect(adapter.fetchByKey).not.toHaveBeenCalled();

        const food = await foodDao.getById(id);
        expect(food?.status).toBe('RESOLVED');
        expect(await queue.getByFoodId(id)).toBeUndefined(); // row deleted (T-154)
        expect(await requesters.countForFood(id)).toBe(0); // requesters pruned (DSN-10)

        const record = await foodDao.readGoldenRecord(id);
        expect(record?.sources.some((source) => source.externalKey === '171688')).toBe(true); // crosswalk written
        expect(record?.nutrients.some((nutrient) => nutrient.name === 'Protein')).toBe(true);

        // T-155 / SC-014: the whole per-source fan-out counts as exactly ONE windowed call.
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM source_call_log WHERE source = 'usda'`,
        );
        expect(rows[0]?.n).toBe('1');

        // T-165: FoodFetchCompleted captured on the fake bus.
        expect(puts).toHaveLength(1);
        expect(puts[0]?.detailType).toBe('FoodFetchCompleted');
        expect(puts[0]?.detail).toMatchObject({ id, status: 'RESOLVED' });
    });

    it('falls back to per-key fetchByKey when the adapter exposes no batch method', async () => {
        const id = await enqueueFood('plain food');
        const searchByName = vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => [
            { source: 'usda', externalKey: '900', name: 'Plain food' },
        ]);
        const fetchByKey = vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(async (externalKey) =>
            makeMergeCandidate('usda', { externalKey, name: 'Plain food' }),
        );
        const adapter: FoodSourceAdapter = { source: 'usda', searchByName, fetchByKey };
        const { consumer } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('resolved');
        expect(fetchByKey).toHaveBeenCalledExactlyOnceWith('900');
        expect((await foodDao.getById(id))?.status).toBe('RESOLVED');
    });

    it('persists UNRESOLVED + a candidate set when >1 distinct name survives', async () => {
        const id = await enqueueFood('broccoli');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockResolvedValue([
            { source: 'usda', externalKey: '1', name: 'Broccoli, raw' },
            { source: 'usda', externalKey: '2', name: 'Broccoli, cooked' },
        ]);
        adapter.fetchByKeys.mockResolvedValue([
            makeMergeCandidate('usda', { externalKey: '1', name: 'Broccoli, raw' }),
            makeMergeCandidate('usda', { externalKey: '2', name: 'Broccoli, cooked' }),
        ]);
        const { consumer, puts } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('unresolved');
        expect((await foodDao.getById(id))?.status).toBe('UNRESOLVED');
        expect(await queue.getByFoodId(id)).toBeUndefined(); // acked off the queue
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM food_candidates WHERE food_id = $1`,
            [id],
        );
        expect(rows[0]?.n).toBe('2');
        expect(puts[0]?.detail).toMatchObject({ id, status: 'UNRESOLVED' });
    });

    it('tombstones NOT_FOUND when no source has the item (FoodFetchCompleted, NO FetchFailed — DSN-9)', async () => {
        const id = await enqueueFood('fictional food xyz');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockResolvedValue([]);
        const { consumer, puts } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('not_found');
        const food = await foodDao.getById(id);
        expect(food?.status).toBe('NOT_FOUND');
        expect(food?.tombstonedAt).not.toBeNull();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
        expect(puts.map((put) => put.detailType)).toEqual(['FoodFetchCompleted']); // NO FetchFailed
        expect(puts[0]?.detail).toMatchObject({ id, status: 'NOT_FOUND' });
    });

    it('5xx → attempts++ with backoff; after 5 real failures → FAILED tombstone + FetchFailed (DSN-9)', async () => {
        const id = await enqueueFood('broken source food');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockRejectedValue(new SourceApiError('usda', 503, 'USDA server error'));
        const { consumer, puts } = build(adapter);

        const dispositions: string[] = [];
        for (let pass = 0; pass < 5; pass += 1) {
            // Simulate the backoff window elapsing so the row is eligible again each pass.
            await pool.query(`UPDATE fetch_queue SET last_requested = now() - interval '1 second' WHERE food_id = $1`, [
                id,
            ]);
            dispositions.push(await consumer.processNext());
        }

        expect(dispositions).toEqual([
            'record_failure',
            'record_failure',
            'record_failure',
            'record_failure',
            'failed',
        ]);
        const food = await foodDao.getById(id);
        expect(food?.status).toBe('FAILED');
        const qrow = await queue.getByFoodId(id);
        expect(qrow?.status).toBe('tombstone');
        expect(qrow?.attempts).toBe(5);
        const detailTypes = puts.map((put) => put.detailType);
        expect(detailTypes).toContain('FoodFetchCompleted');
        expect(detailTypes).toContain('FetchFailed');
    });

    it('a single 5xx backs the row off into the future without consuming the budget prematurely', async () => {
        const id = await enqueueFood('flaky food');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockRejectedValue(new SourceApiError('usda', 500, 'USDA server error'));
        const { consumer } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('record_failure');
        const qrow = await queue.getByFoodId(id);
        expect(qrow?.status).toBe('pending');
        expect(qrow?.attempts).toBe(1);
        // backoff pushed last_requested into the future → not immediately eligible.
        expect(qrow && qrow.lastRequested.getTime()).toBeGreaterThan(Date.now());
        expect(await consumer.processNext()).toBe('idle');
    });

    it('limiter pause at 90% halts fan-out for that source (deferred; no source call, no event)', async () => {
        const id = await enqueueFood('paused food');
        for (let i = 0; i < 9; i += 1) {
            await pool.query(`INSERT INTO source_call_log (source, called_at) VALUES ('usda', now())`);
        }
        const adapter = makeFakeUsdaAdapter();
        const { consumer, puts } = build(adapter, { usda: { hardCap: 10, pauseThreshold: 9 } });

        const disposition = await consumer.processNext();

        expect(disposition).toBe('deferred');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect((await foodDao.getById(id))?.status).toBe('PENDING');
        expect((await queue.getByFoodId(id))?.status).toBe('pending'); // re-queued, not in_flight
        expect(puts).toHaveLength(0);
    });

    it('reapStaleLeases reverts a stale in_flight lease back to pending (FR-018)', async () => {
        const id = await enqueueFood('stale lease food');
        await queue.leaseNext(30);
        await pool.query(`UPDATE fetch_queue SET leased_at = now() - interval '120 seconds' WHERE food_id = $1`, [id]);
        const { consumer } = build(makeFakeUsdaAdapter());

        const reclaimed = await consumer.reapStaleLeases();

        expect(reclaimed).toBe(1);
        expect((await queue.getByFoodId(id))?.status).toBe('pending');
    });

    it('drain processes every eligible row until the queue is empty', async () => {
        const apple = await enqueueFood('apple');
        const banana = await enqueueFood('banana');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockImplementation(async (name) => [{ source: 'usda', externalKey: `key_${name}`, name }]);
        adapter.fetchByKeys.mockImplementation(async (keys) =>
            keys.map((externalKey) => makeMergeCandidate('usda', { externalKey, name: 'single survivor' })),
        );
        const { consumer } = build(adapter);

        const processed = await consumer.drain();

        expect(processed).toBe(2);
        expect(await queue.getByFoodId(apple)).toBeUndefined();
        expect(await queue.getByFoodId(banana)).toBeUndefined();
    });

    it('single-drainer: two sessions race the worker lock — exactly one acquires it (FR-022, TST-7)', async () => {
        const sessionA = await pool.connect();
        const sessionB = await pool.connect();

        try {
            const lockedA = await acquireWorkerLock(sessionA);
            const lockedB = await acquireWorkerLock(sessionB);

            expect(lockedA).toBe(true);
            expect(lockedB).toBe(false);
        } finally {
            await sessionA.query('SELECT pg_advisory_unlock_all()');
            await sessionB.query('SELECT pg_advisory_unlock_all()');
            sessionA.release();
            sessionB.release();
        }
    });
});
