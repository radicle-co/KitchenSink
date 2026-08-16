/**
 * Integration suite for the Phase-5 fan-out/merge worker (T-150..T-155, T-165) over REAL Postgres with
 * MOCKED source adapters + a fake event bus. Exercises the full enqueue → lease → fan-out → batch
 * fetch → merge → RESOLVED → row-deleted → FoodFetchCompleted flow, plus NOT_FOUND, the 5xx
 * backoff→FAILED budget, the 90% limiter pause, the lease reaper, the per-key fallback, and the
 * single-drainer advisory lock (TST-7). No real network/AWS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type pg from 'pg';

import { InMemoryPublisher } from '@kitchensink/messaging';
import { FoodEventEmitter } from '../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../src/foods/dao/fetchQueue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetchRequesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/foodSources.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/sourceCallLog.dao.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../src/foods/merge/mergeAndPersist.service.js';
import { SourceAdapterRegistry } from '../src/sources/SourceAdapterRegistry.js';
import { SourceApiError } from '../src/sources/foodSource.errors.js';
import {
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/foodSourceAdapter.js';
import { RollingWindowLimiter, sourceCapsFromEnv, type SourceCap } from '../src/sources/RollingWindowLimiter.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { acquireWorkerLock } from '../src/worker/workerLock.js';
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
        concurrency?: number,
    ): { consumer: FoodConsumerService; publisher: InMemoryPublisher } {
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const limiter = new RollingWindowLimiter(new SourceCallLogDao(db), caps ? { caps } : undefined);
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry));
        const publisher = new InMemoryPublisher();
        const consumer = new FoodConsumerService({
            foodDao,
            sources: new FoodSourcesDao(db),
            queue,
            registry,
            limiter,
            merge,
            events: new FoodEventEmitter(publisher),
            logger: new SilentWorkerLogger(),
            ...(concurrency !== undefined ? { concurrency } : {}),
        });

        return { consumer, publisher };
    }

    /** Enqueue a freshly created PENDING food with one requester. */
    async function enqueueFood(normalizedName: string, displayName?: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: displayName ?? normalizedName });
        await requesters.add({ foodId: id, requesterId: '01J9ZK8N7QF3B2X4M6T0V5C1AB' });
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
        const { consumer, publisher } = build(adapter);

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
        expect(publisher.messages).toHaveLength(1);
        expect(publisher.messages[0]?.kind).toBe('FoodFetchCompleted');
        expect(publisher.messages[0]?.payload).toMatchObject({ id, status: 'RESOLVED' });
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
        const { consumer, publisher } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('unresolved');
        expect((await foodDao.getById(id))?.status).toBe('UNRESOLVED');
        expect(await queue.getByFoodId(id)).toBeUndefined(); // acked off the queue
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*) AS n FROM food_candidates WHERE food_id = $1`,
            [id],
        );
        expect(rows[0]?.n).toBe('2');
        expect(publisher.messages[0]?.payload).toMatchObject({ id, status: 'UNRESOLVED' });
    });

    it('tombstones NOT_FOUND when no source has the item (FoodFetchCompleted, NO FetchFailed — DSN-9)', async () => {
        const id = await enqueueFood('fictional food xyz');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockResolvedValue([]);
        const { consumer, publisher } = build(adapter);

        const disposition = await consumer.processNext();

        expect(disposition).toBe('not_found');
        const food = await foodDao.getById(id);
        expect(food?.status).toBe('NOT_FOUND');
        expect(food?.tombstonedAt).not.toBeNull();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
        expect(publisher.messages.map((put) => put.kind)).toEqual(['FoodFetchCompleted']); // NO FetchFailed
        expect(publisher.messages[0]?.payload).toMatchObject({ id, status: 'NOT_FOUND' });
    });

    it('a genuine 5xx (500) → attempts++ with backoff; after 5 real failures → FAILED tombstone + FetchFailed (DSN-9)', async () => {
        const id = await enqueueFood('broken source food');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockRejectedValue(new SourceApiError('usda', 500, 'USDA server error'));
        const { consumer, publisher } = build(adapter);

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
        const detailTypes = publisher.messages.map((put) => put.kind);
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

    it('gateway backpressure (502/503/504) → deferred + source paused, NO attempts++ (not a per-food failure)', async () => {
        for (const status of [502, 503, 504]) {
            await resetSchema(pool);
            const id = await enqueueFood(`gateway ${status} food`);
            const adapter = makeFakeUsdaAdapter();
            adapter.searchByName.mockRejectedValue(new SourceApiError('usda', status, 'gateway backpressure'));
            const { consumer } = build(adapter);

            expect(await consumer.processNext()).toBe('deferred');

            const qrow = await queue.getByFoodId(id);
            expect(qrow?.status).toBe('pending'); // re-queued, not failed
            expect(qrow?.attempts).toBe(0); // backpressure never consumes the retry budget

            // markWindowFull paused the whole source: a re-eligible row defers again WITHOUT a second search.
            await pool.query(`UPDATE fetch_queue SET last_requested = now() - interval '1 minute' WHERE food_id = $1`, [
                id,
            ]);
            expect(await consumer.processNext()).toBe('deferred');
            expect(adapter.searchByName).toHaveBeenCalledTimes(1); // 2nd pass blocked by the source-wide pause
        }
    });

    it('client timeout / transport failure (statusCode 0) → deferred, NO attempts++ and NO source-wide pause', async () => {
        const id = await enqueueFood('timing-out food');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockRejectedValue(new SourceApiError('usda', 0, 'USDA request timed out'));
        const { consumer } = build(adapter);

        expect(await consumer.processNext()).toBe('deferred');

        const qrow = await queue.getByFoodId(id);
        expect(qrow?.status).toBe('pending');
        // A self-inflicted latency timeout must NOT burn the failure budget / tombstone an otherwise-good food.
        expect(qrow?.attempts).toBe(0);

        // Unlike gateway backpressure, an isolated timeout does NOT markWindowFull: a re-eligible row
        // re-attempts the fan-out (searches again) rather than being blocked by a source-wide pause.
        await pool.query(`UPDATE fetch_queue SET last_requested = now() - interval '1 minute' WHERE food_id = $1`, [
            id,
        ]);
        expect(await consumer.processNext()).toBe('deferred');
        expect(adapter.searchByName).toHaveBeenCalledTimes(2); // retried — the source was never paused
    });

    it('schema drift (422) → attempts++ genuine failure (a persistently malformed item, not backpressure)', async () => {
        const id = await enqueueFood('schema-drift food');
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockRejectedValue(
            new SourceApiError('usda', 422, 'USDA response failed schema validation'),
        );
        const { consumer } = build(adapter);

        expect(await consumer.processNext()).toBe('record_failure');
        expect((await queue.getByFoodId(id))?.attempts).toBe(1);
    });

    it('limiter pause at 90% halts fan-out for that source (deferred; no source call, no event)', async () => {
        const id = await enqueueFood('paused food');

        for (let i = 0; i < 9; i += 1) {
            await pool.query(`INSERT INTO source_call_log (source, called_at) VALUES ('usda', now())`);
        }

        const adapter = makeFakeUsdaAdapter();
        const { consumer, publisher } = build(adapter, { usda: { hardCap: 10, pauseThreshold: 9 } });

        const disposition = await consumer.processNext();

        expect(disposition).toBe('deferred');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect((await foodDao.getById(id))?.status).toBe('PENDING');
        expect((await queue.getByFoodId(id))?.status).toBe('pending'); // re-queued, not in_flight
        expect(publisher.messages).toHaveLength(0);
    });

    it('stalls at the cap then RESUMES draining once the rolling window clears (stall→resume, FR-019/FR-021/FR-026)', async () => {
        // A fake USDA that resolves any food to a golden candidate, so a processed food reaches a terminal
        // state and leaves the queue — letting us assert the queue stalls, then fully drains after resume.
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockImplementation(async (name) => [{ source: 'usda', externalKey: `k-${name}`, name }]);
        adapter.fetchByKeys.mockImplementation(async (keys) =>
            keys.map((key) => makeMergeCandidate('usda', { externalKey: key, name: key })),
        );
        const { consumer } = build(adapter, { usda: { hardCap: 3, pauseThreshold: 3 } });

        // Enqueue 5 distinct foods — more than the cap of 3.
        for (let i = 0; i < 5; i += 1) {
            await enqueueFood(`ratelimit food ${i}`);
        }

        // The first 3 each charge one windowed call and reach a terminal state (row deleted).
        for (let i = 0; i < 3; i += 1) {
            expect(await consumer.processNext()).not.toBe('deferred');
        }

        // STALL: the window is now full (3 >= pause threshold). Every further claim DEFERS — the remaining
        // foods stay pending (no source call, no attempts++), stuck in the queue until the limit clears.
        expect(await consumer.processNext()).toBe('deferred');
        const stalled = await pool.query(`SELECT count(*)::int AS n FROM fetch_queue WHERE status = 'pending'`);
        expect(Number(stalled.rows[0].n)).toBe(2); // the 2 un-processed foods are stalled in the queue

        // The rate limit CLEARS: recorded calls age out of the trailing window (time passing), and the
        // 30s pause-defer backoff elapses so the stalled rows are eligible to claim again.
        await pool.query(`UPDATE source_call_log SET called_at = now() - interval '2 hours'`);
        await pool.query(`UPDATE fetch_queue SET last_requested = now() WHERE status = 'pending'`);

        // RESUME: with the window clear, the stalled foods drain to a terminal state and leave the queue.
        for (let i = 0; i < 5; i += 1) {
            if ((await consumer.processNext()) === 'idle') {
                break;
            }
        }

        const drained = await pool.query(`SELECT count(*)::int AS n FROM fetch_queue`);
        expect(Number(drained.rows[0].n)).toBe(0); // fully drained once the limit cleared
    });

    it('the worker honors the configured cap via FOOD_SOURCE_RATE_LIMIT_PER_HOUR (sourceCapsFromEnv)', async () => {
        const prev = process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'];
        process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = '20';

        try {
            const caps = sourceCapsFromEnv();
            expect(caps.usda.hardCap).toBe(20);
            expect(caps.usda.pauseThreshold).toBe(18); // 90%
        } finally {
            if (prev === undefined) {
                delete process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'];
            } else {
                process.env['FOOD_SOURCE_RATE_LIMIT_PER_HOUR'] = prev;
            }
        }
    });

    it('drain(concurrency=K) overlaps foods in-flight and drains them all (serial would be 1)', async () => {
        // Track the max simultaneous in-flight source calls; a small delay lets multiple foods overlap.
        let inFlight = 0;
        let maxInFlight = 0;
        const adapter = makeFakeUsdaAdapter();
        adapter.searchByName.mockImplementation(async (name) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((res) => setTimeout(res, 40));
            inFlight -= 1;

            return [{ source: 'usda', externalKey: `k-${name}`, name }];
        });
        adapter.fetchByKeys.mockImplementation(async (keys) =>
            keys.map((key) => makeMergeCandidate('usda', { externalKey: key, name: key })),
        );
        const { consumer } = build(adapter, undefined, 4);

        for (let i = 0; i < 8; i += 1) {
            await enqueueFood(`concurrent food ${i}`);
        }

        const processed = await consumer.drain();

        expect(processed).toBe(8); // every food drained
        expect(maxInFlight).toBeGreaterThan(1); // the fan-outs overlapped (a serial drain never exceeds 1)
        const remaining = await pool.query(`SELECT count(*)::int AS n FROM fetch_queue`);
        expect(Number(remaining.rows[0].n)).toBe(0);
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
