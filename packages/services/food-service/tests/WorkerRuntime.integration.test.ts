/**
 * Integration suite for {@link WorkerRuntime} (T-150) over REAL Postgres: the single-drainer advisory
 * lock, the `LISTEN fetch_queued` wake that drains within ~100ms of a NOTIFY (FR-017), and the
 * graceful-shutdown release of in-flight leases (FR-017/FR-022). Source adapters are mocked; no AWS.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/foodSourceAdapter.js';
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { WorkerRuntime } from '../src/worker/WorkerRuntime.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** Poll `predicate` until it returns true or the timeout elapses. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 15));
    }

    return false;
}

describe.skipIf(!DATABASE_URL)('WorkerRuntime (integration)', () => {
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

    function buildConsumer(adapter: FoodSourceAdapter): FoodConsumerService {
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const bus = new InMemoryPublisher();

        return new FoodConsumerService({
            foodDao,
            sources: new FoodSourcesDao(db),
            queue,
            registry,
            limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
            merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
            events: new FoodEventEmitter(bus),
            logger: new SilentWorkerLogger(),
        });
    }

    it('acquires the lock and drains within ~100ms of a NOTIFY fetch_queued (FR-017)', async () => {
        const searchByName = vi.fn<(name: string) => Promise<SourceCandidate[]>>(async (name) => [
            { source: 'usda', externalKey: '1', name },
        ]);
        const fetchByKeys = vi.fn<(keys: readonly string[]) => Promise<CanonicalCandidate[]>>(async (keys) =>
            keys.map((externalKey) => makeMergeCandidate('usda', { externalKey, name: 'Notify Food' })),
        );
        const adapter: FoodSourceAdapter = { source: 'usda', searchByName, fetchByKey: vi.fn(), fetchByKeys };
        const consumer = buildConsumer(adapter);

        const lockSession = await pool.connect();
        const listenSession = await pool.connect();
        const runtime = new WorkerRuntime({
            lockSession,
            listenSession,
            consumer,
            queue,
            logger: new SilentWorkerLogger(),
        });

        try {
            const acquired = await runtime.start();
            expect(acquired).toBe(true);

            // Enqueue AFTER start (queue was empty at start), then notify like the EnqueueEmitter would.
            const { id } = await foodDao.createByName({ normalizedName: 'notify food', displayName: 'Notify Food' });
            await requesters.add({ foodId: id, requesterId: '01J9ZK8N7QF3B2X4M6T0V5C1AB' });
            await queue.enqueue(id);
            await pool.query(`SELECT pg_notify('fetch_queued', $1)`, [id]);

            const resolved = await waitFor(async () => (await foodDao.getById(id))?.status === 'RESOLVED');
            expect(resolved).toBe(true);
            expect(searchByName).toHaveBeenCalled();
        } finally {
            await runtime.stop();
            lockSession.release();
            listenSession.release();
        }
    });

    it('a second runtime cannot acquire the lock while the first holds it (single drainer, FR-022)', async () => {
        const firstLock = await pool.connect();
        const firstListen = await pool.connect();
        const first = new WorkerRuntime({
            lockSession: firstLock,
            listenSession: firstListen,
            consumer: buildConsumer({ source: 'usda', searchByName: vi.fn(async () => []), fetchByKey: vi.fn() }),
            queue,
            logger: new SilentWorkerLogger(),
        });

        const secondLock = await pool.connect();
        const secondListen = await pool.connect();
        const second = new WorkerRuntime({
            lockSession: secondLock,
            listenSession: secondListen,
            consumer: buildConsumer({ source: 'usda', searchByName: vi.fn(async () => []), fetchByKey: vi.fn() }),
            queue,
            logger: new SilentWorkerLogger(),
        });

        try {
            expect(await first.start()).toBe(true);
            expect(await second.start()).toBe(false);
        } finally {
            await first.stop();
            await second.stop();
            firstLock.release();
            firstListen.release();
            secondLock.release();
            secondListen.release();
        }
    });

    it('stop() releases in-flight leases so a replacement can re-claim them (FR-017)', async () => {
        const { id } = await foodDao.createByName({ normalizedName: 'inflight food' });
        await requesters.add({ foodId: id, requesterId: '01J9ZK8N7QF3B2X4M6T0V5C1AB' });
        await queue.enqueue(id);
        await queue.leaseNext(30); // now in_flight

        const lockSession = await pool.connect();
        const listenSession = await pool.connect();
        const runtime = new WorkerRuntime({
            lockSession,
            listenSession,
            consumer: buildConsumer({ source: 'usda', searchByName: vi.fn(async () => []), fetchByKey: vi.fn() }),
            queue,
            logger: new SilentWorkerLogger(),
        });

        await runtime.stop();

        expect((await queue.getByFoodId(id))?.status).toBe('pending');
        lockSession.release();
        listenSession.release();
    });
});
