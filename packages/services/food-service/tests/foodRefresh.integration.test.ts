/**
 * Integration suite for the worker's change-driven REFRESH branch (T-171, FR-031/FR-032/REQ-053) over
 * REAL Postgres with a MOCKED source adapter. A `RESOLVED` food that reaches the drainer takes the
 * selective in-place re-pull branch (DSN-4) — NOT the by-name fan-out:
 *
 *   - re-fetch each backing `food_sources` item by `external_key`, compare `item_version`;
 *   - re-pull a field ONLY when its originating item changed upstream (updates `source_id` + `item_version`);
 *   - an all-unchanged food is left untouched (no golden-record writes);
 *   - the food STAYS `RESOLVED` — a refresh never demotes it to `UNRESOLVED` and never clobbers a pick.
 *
 * No real network/AWS — `fetchByKey` is a vitest mock whose return value (incl. `itemVersion`) the test
 * controls to simulate an unchanged item or an upstream change.
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
import { RollingWindowLimiter } from '../src/sources/RollingWindowLimiter.js';
import { FoodConsumerService } from '../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../src/worker/SilentWorkerLogger.js';
import { DATABASE_URL, makeDb, makePool, resetSchema, type TestDb } from './support/db.js';

/** A fake USDA adapter whose `fetchByKey` the test programs (the refresh re-fetch seam). */
type FakeUsdaAdapter = FoodSourceAdapter & {
    searchByName: Mock<(name: string) => Promise<SourceCandidate[]>>;
    fetchByKey: Mock<(externalKey: string) => Promise<CanonicalCandidate>>;
};

/** Build a fresh fake USDA adapter. */
function makeFakeUsdaAdapter(): FakeUsdaAdapter {
    return {
        source: 'usda',
        searchByName: vi.fn<(name: string) => Promise<SourceCandidate[]>>(async () => []),
        fetchByKey: vi.fn<(externalKey: string) => Promise<CanonicalCandidate>>(),
    };
}

describe.skipIf(!DATABASE_URL)('FoodConsumerService — change-refresh branch (integration)', () => {
    let pool: pg.Pool;
    let db: TestDb;
    let foodDao: FoodDao;
    let sources: FoodSourcesDao;
    let queue: FetchQueueDao;
    let requesters: FetchRequestersDao;

    beforeAll(() => {
        pool = makePool();
        db = makeDb(pool);
        foodDao = new FoodDao(db);
        sources = new FoodSourcesDao(db);
        queue = new FetchQueueDao(db);
        requesters = new FetchRequestersDao(db);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetSchema(pool);
    });

    /** Wire a fresh consumer around the fake adapter; capture emitted events. */
    function build(adapter: FoodSourceAdapter): { consumer: FoodConsumerService; publisher: InMemoryPublisher } {
        const registry = new SourceAdapterRegistry();
        registry.register(adapter);
        const limiter = new RollingWindowLimiter(new SourceCallLogDao(db));
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry));
        const publisher = new InMemoryPublisher();
        const consumer = new FoodConsumerService({
            foodDao,
            sources,
            queue,
            registry,
            limiter,
            merge,
            events: new FoodEventEmitter(publisher),
            logger: new SilentWorkerLogger(),
        });

        return { consumer, publisher };
    }

    /** Resolve a single-source food to RESOLVED with one backing item at `itemVersion`. */
    async function seedResolved(opts: {
        normalizedName: string;
        externalKey: string;
        itemVersion: string;
        description?: string | null;
        proteinAmount?: string;
    }): Promise<string> {
        const { id } = await foodDao.createByName({
            normalizedName: opts.normalizedName,
            displayName: opts.normalizedName,
        });
        // priorityOf('usda') resolves from SOURCE_PRIORITY regardless of which adapters are registered,
        // so a bare registry is enough to seed the RESOLVED record deterministically.
        const merge = new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry()));
        await merge.resolveAndPersist({
            foodId: id,
            candidates: [
                makeMergeCandidate('usda', {
                    externalKey: opts.externalKey,
                    name: opts.normalizedName,
                    description: opts.description ?? null,
                    itemVersion: opts.itemVersion,
                    nutrients: [
                        {
                            code: null,
                            name: 'Protein',
                            unit: 'g',
                            amount: opts.proteinAmount ?? '2.8',
                            basis: 'per_100g',
                        },
                    ],
                    portions: [{ label: '1 cup', gramWeight: '91' }],
                }),
            ],
        });

        return id;
    }

    /** Enqueue a low-demand change-refresh row for an already-RESOLVED food. */
    async function enqueueRefresh(id: string): Promise<void> {
        await requesters.add({ foodId: id, requesterId: 'svc_change_refresh' });
        await queue.enqueue(id);
    }

    it('re-pulls a CHANGED item in place: new values + item_version + provenance, food stays RESOLVED', async () => {
        const adapter = makeFakeUsdaAdapter();
        const id = await seedResolved({
            normalizedName: 'broccoli, raw',
            externalKey: '171688',
            itemVersion: 'v1',
            description: 'old florets',
            proteinAmount: '2.8',
        });

        // Upstream changed: a new itemVersion + new nutrient amount + new description.
        adapter.fetchByKey.mockResolvedValue(
            makeMergeCandidate('usda', {
                externalKey: '171688',
                name: 'Broccoli, raw',
                description: 'fresh florets',
                itemVersion: 'v2',
                nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '3.5', basis: 'per_100g' }],
                portions: [{ label: '1 cup', gramWeight: '91' }],
            }),
        );

        const { consumer, publisher } = build(adapter);
        await enqueueRefresh(id);
        const disposition = await consumer.processNext();
        expect(disposition).toBe('refreshed');

        // Re-fetched by external_key — NOT a name fan-out.
        expect(adapter.searchByName).not.toHaveBeenCalled();
        expect(adapter.fetchByKey).toHaveBeenCalledWith('171688');

        const record = await foodDao.readGoldenRecord(id);
        expect(record?.status).toBe('RESOLVED');
        expect(record?.description).toBe('fresh florets');
        expect(record?.nutrients.find((n) => n.name === 'Protein')?.amount).toBe('3.5');
        // The crosswalk item_version advanced to the new upstream version.
        expect(record?.sources[0]?.itemVersion).toBe('v2');

        // Queue row acked; completion emitted.
        expect(await queue.getByFoodId(id)).toBeUndefined();
        expect(publisher.messages.filter((p) => p.kind === 'FoodFetchCompleted')).toHaveLength(1);
    });

    it('leaves an ALL-UNCHANGED food untouched (no golden-record writes)', async () => {
        const adapter = makeFakeUsdaAdapter();
        const id = await seedResolved({
            normalizedName: 'spinach',
            externalKey: 'ek-spinach',
            itemVersion: 'v1',
            description: 'leafy',
            proteinAmount: '2.9',
        });

        const before = await pool.query<{ updated_at: Date; n_amount: string; item_version: string; fetched_at: Date }>(
            `SELECT f.updated_at, fn.amount AS n_amount, fs.item_version, fs.fetched_at
               FROM food f
               JOIN food_sources fs ON fs.food_id = f.id
               JOIN food_nutrients fn ON fn.food_id = f.id
              WHERE f.id = $1`,
            [id],
        );

        // Upstream UNCHANGED: same itemVersion is returned by the re-fetch.
        adapter.fetchByKey.mockResolvedValue(
            makeMergeCandidate('usda', {
                externalKey: 'ek-spinach',
                name: 'spinach',
                description: 'leafy',
                itemVersion: 'v1',
                nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '2.9', basis: 'per_100g' }],
                portions: [{ label: '1 cup', gramWeight: '91' }],
            }),
        );

        const { consumer } = build(adapter);
        await enqueueRefresh(id);
        expect(await consumer.processNext()).toBe('refreshed');

        const after = await pool.query<{ updated_at: Date; n_amount: string; item_version: string; fetched_at: Date }>(
            `SELECT f.updated_at, fn.amount AS n_amount, fs.item_version, fs.fetched_at
               FROM food f
               JOIN food_sources fs ON fs.food_id = f.id
               JOIN food_nutrients fn ON fn.food_id = f.id
              WHERE f.id = $1`,
            [id],
        );

        // No golden-record write occurred — every value/timestamp is byte-identical.
        expect(after.rows[0]!.updated_at.getTime()).toBe(before.rows[0]!.updated_at.getTime());
        expect(after.rows[0]!.n_amount).toBe(before.rows[0]!.n_amount);
        expect(after.rows[0]!.item_version).toBe('v1');
        expect(after.rows[0]!.fetched_at.getTime()).toBe(before.rows[0]!.fetched_at.getTime());
        expect((await foodDao.getById(id))?.status).toBe('RESOLVED');
    });

    it('never demotes a RESOLVED food to UNRESOLVED, even when the re-fetched item changed name', async () => {
        const adapter = makeFakeUsdaAdapter();
        const id = await seedResolved({ normalizedName: 'kale', externalKey: 'ek-kale', itemVersion: 'v1' });

        adapter.fetchByKey.mockResolvedValue(
            makeMergeCandidate('usda', {
                externalKey: 'ek-kale',
                name: 'Kale, curly',
                itemVersion: 'v2',
                nutrients: [{ code: null, name: 'Protein', unit: 'g', amount: '4.3', basis: 'per_100g' }],
            }),
        );

        const { consumer } = build(adapter);
        await enqueueRefresh(id);
        await consumer.processNext();

        // Disambiguation is NEVER re-run on refresh — the food cannot drop back to UNRESOLVED.
        expect((await foodDao.getById(id))?.status).toBe('RESOLVED');
        expect(
            (await pool.query('SELECT count(*)::int AS n FROM food_candidates WHERE food_id = $1', [id])).rows[0].n,
        ).toBe(0);
    });

    it('skips an item whose re-fetch errors, leaving its field(s) intact (no overwrite)', async () => {
        const adapter = makeFakeUsdaAdapter();
        const id = await seedResolved({
            normalizedName: 'quinoa',
            externalKey: 'ek-quinoa',
            itemVersion: 'v1',
            proteinAmount: '4.4',
        });

        adapter.fetchByKey.mockRejectedValue(new SourceApiError('usda', 503, 'boom'));

        const { consumer } = build(adapter);
        await enqueueRefresh(id);
        await consumer.processNext();

        const record = await foodDao.readGoldenRecord(id);
        expect(record?.status).toBe('RESOLVED');
        expect(record?.nutrients.find((n) => n.name === 'Protein')?.amount).toBe('4.4');
        expect(record?.sources[0]?.itemVersion).toBe('v1');
    });
});
