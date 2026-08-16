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
    function build(): { consumer: FoodConsumerService; adapter: FakeAdapter; publisher: InMemoryPublisher } {
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
        });

        return { consumer, adapter, publisher };
    }

    /** Create a PENDING food + a pending queue row, with NO requester rows by default. */
    async function seedWithoutRequester(normalizedName: string): Promise<string> {
        const { id } = await foodDao.createByName({ normalizedName, displayName: normalizedName });
        await pool.query(`INSERT INTO fetch_queue (food_id, status) VALUES ($1, 'pending')`, [id]);

        return id;
    }

    it('refuses to drain a row with NO recorded requester → tombstone, no source call', async () => {
        const id = await seedWithoutRequester('orphan enqueue');
        const { consumer, adapter, publisher } = build();

        const disposition = await consumer.processNext();

        expect(disposition).toBe('rejected_provenance');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect(adapter.fetchByKeys).not.toHaveBeenCalled();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
        expect((await queue.getByFoodId(id))?.lastError).toBe('unauthenticated_producer');
        // No external call was logged against the window, and no completion event fired.
        const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM source_call_log`);
        expect(rows[0]?.n).toBe('0');
        expect(publisher.messages).toHaveLength(0);
    });

    it('refuses a row whose recorded requester is the forbidden "system" shortcut', async () => {
        const id = await seedWithoutRequester('system enqueue');
        await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, 'system')`, [id]);
        const { consumer, adapter } = build();

        expect(await consumer.processNext()).toBe('rejected_provenance');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
    });

    it('refuses a row keyed by a legacy raw Clerk sub (a pre-U1 row) — not a ULID, not svc_ (CR-002/U1)', async () => {
        // A stranded pre-cutover row is keyed by a raw `user_*` Clerk sub; the tightened validator (U1)
        // rejects it so a legacy row cannot drive a source call. The 0002 migration purges such rows, but
        // the runtime guard must ALSO refuse them defensively.
        const id = await seedWithoutRequester('legacy sub enqueue');
        await pool.query(`INSERT INTO fetch_requesters (food_id, requester_id) VALUES ($1, 'user_2legacy')`, [id]);
        const { consumer, adapter } = build();

        expect(await consumer.processNext()).toBe('rejected_provenance');
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect((await queue.getByFoodId(id))?.status).toBe('tombstone');
    });

    it('drains a row with a valid recorded requester (an app-user ULID) normally', async () => {
        const id = await seedWithoutRequester('legit enqueue');
        await requesters.add({ foodId: id, requesterId: '01J9ZK8N7QF3B2X4M6T0V5C1AB' });
        const { consumer, adapter } = build();

        const disposition = await consumer.processNext();

        expect(disposition).toBe('resolved');
        expect(adapter.searchByName).toHaveBeenCalledTimes(1);
        expect((await foodDao.getById(id))?.status).toBe('RESOLVED');
    });

    it('drains a refresh row enqueued by the allowlisted svc_change_refresh principal', async () => {
        const id = await seedWithoutRequester('svc refresh enqueue');
        await requesters.add({ foodId: id, requesterId: 'svc_change_refresh' });
        const { consumer, adapter } = build();

        expect(await consumer.processNext()).toBe('resolved');
        expect(adapter.searchByName).toHaveBeenCalledTimes(1);
    });
});
