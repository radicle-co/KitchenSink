/**
 * Integration guarantee for async-producer provenance (T-053, FR-048) over REAL Postgres with a mocked
 * source adapter. The consumer MUST refuse to drain a leased `fetch_queue` row whose recorded
 * `fetch_requesters` set does not name a real principal — a row with NO requester, or one carrying the
 * forbidden `'system'` shortcut — WITHOUT making any external source call, so no unauthenticated /
 * unauthorized producer can drive source consumption. A row with a valid requester drains normally.
 *
 * (The least-privilege IAM half of T-053 — only named roles may `events:PutEvents` / insert — is CDK
 * infrastructure and is out of scope here.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type pg from 'pg';

import { FoodEventEmitter, type EventBus, type EventBusPutInput } from '../src/events/food-event-emitter.js';
import { FetchQueueDao } from '../src/foods/dao/fetch-queue.dao.js';
import { FetchRequestersDao } from '../src/foods/dao/fetch-requesters.dao.js';
import { FoodDao } from '../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../src/foods/dao/food-sources.dao.js';
import { SourceCallLogDao } from '../src/foods/dao/source-call-log.dao.js';
import { makeMergeCandidate } from '../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../src/foods/merge/merge-engine.js';
import { MergeAndPersistService } from '../src/foods/merge/merge-and-persist.service.js';
import {
    SourceAdapterRegistry,
    type CanonicalCandidate,
    type FoodSourceAdapter,
    type SourceCandidate,
} from '../src/sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../src/sources/rolling-window-limiter.js';
import { FoodConsumerService } from '../src/worker/food-consumer.service.js';
import { SilentWorkerLogger } from '../src/worker/worker-logger.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

type FakeAdapter = FoodSourceAdapter & {
    searchByName: Mock<(name: string) => Promise<SourceCandidate[]>>;
    fetchByKey: Mock<(key: string) => Promise<CanonicalCandidate>>;
    fetchByKeys: Mock<(keys: readonly string[]) => Promise<CanonicalCandidate[]>>;
};

describe.skipIf(!DATABASE_URL)('async-producer provenance (integration, FR-048)', () => {
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

    /** Build a consumer over a fake adapter; expose the adapter (to assert it is never called) + events. */
    function build(): { consumer: FoodConsumerService; adapter: FakeAdapter; puts: EventBusPutInput[] } {
        const adapter: FakeAdapter = {
            source: 'usda',
            searchByName: vi.fn(async () => [{ source: 'usda', externalKey: 'k1', name: 'X' }]),
            fetchByKey: vi.fn(async () => makeMergeCandidate('usda', { externalKey: 'k1', name: 'X' })),
            fetchByKeys: vi.fn(async () => [makeMergeCandidate('usda', { externalKey: 'k1', name: 'X' })]),
        };
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const limiter = new RollingWindowLimiter(new SourceCallLogDao(db));
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry));
        const puts: EventBusPutInput[] = [];
        const bus: EventBus = { putEvent: async (input) => void puts.push(input) };
        const consumer = new FoodConsumerService({
            foodDao,
            sources: new FoodSourcesDao(db),
            queue,
            registry,
            limiter,
            merge,
            events: new FoodEventEmitter(bus),
            logger: new SilentWorkerLogger(),
        });

        return { consumer, adapter, puts };
    }

    /** Create a PENDING food + a pending queue row, with NO requester rows by default. */
    async function seedWithoutRequester(normalizedName: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: normalizedName });
        await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);

        return id;
    }

    it('refuses to drain a row with NO recorded requester → tombstone, no source call', async () => {
        const id = await seedWithoutRequester('orphan enqueue');
        const { consumer, adapter, puts } = build();

        const disposition = await consumer.processNext();

        expect(disposition).toBe('rejected_provenance');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect(adapter.fetchByKeys).not.toHaveBeenCalled();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
        expect((await queue.getByFoodId(id))?.lastError).toBe('unauthenticated_producer');
        // No external call was logged against the window, and no completion event fired.
        const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM source_call_log`);
        expect(rows[0]?.n).toBe('0');
        expect(puts).toHaveLength(0);
    });

    it('refuses a row whose recorded requester is the forbidden "system" shortcut', async () => {
        const id = await seedWithoutRequester('system enqueue');
        await pool.query(`INSERT INTO fetch_requesters (food_id, sub) VALUES ($1, 'system')`, [id]);
        const { consumer, adapter } = build();

        expect(await consumer.processNext()).toBe('rejected_provenance');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
    });

    it('drains a row with a valid recorded requester (a real user sub) normally', async () => {
        const id = await seedWithoutRequester('legit enqueue');
        await requesters.add({ foodId: id, sub: 'user_legit' });
        const { consumer, adapter } = build();

        const disposition = await consumer.processNext();

        expect(disposition).toBe('resolved');
        expect(adapter.searchByName).toHaveBeenCalledTimes(1);
        expect((await foodDao.getById(id))?.status).toBe('RESOLVED');
    });

    it('drains a refresh row enqueued by the allowlisted svc_change_refresh principal', async () => {
        const id = await seedWithoutRequester('svc refresh enqueue');
        await requesters.add({ foodId: id, sub: 'svc_change_refresh' });
        const { consumer, adapter } = build();

        expect(await consumer.processNext()).toBe('resolved');
        expect(adapter.searchByName).toHaveBeenCalledTimes(1);
    });
});
