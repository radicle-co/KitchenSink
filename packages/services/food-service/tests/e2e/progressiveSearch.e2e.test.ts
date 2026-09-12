/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): the progressive search and the remote pick through the booted food app
 * on a real Postgres (ADR-0055 points 4 to 10). The app is configured exactly as a deployed task is, with its remote
 * search settings pointing at a loopback stand-in for the CloudFront distribution (`support/searchEdgeStandIn.ts`:
 * signatures, cache key, TTLs), in front of a double of the search function (`support/searchFunctionDouble.ts`), and
 * its USDA client at a loopback stub for the pick's one fetch. It proves food's protocol against a model of the CDN,
 * not CloudFront; the deployed distribution is S7.10's.
 *
 * | What only a real database shows                                          | Pinned here                                   |
 * | ------------------------------------------------------------------------ | --------------------------------------------- |
 * | a cached answer spends nothing                                           | a hit writes no `source_call_log` row; a miss writes one |
 * | a cook at their limit still gets our database, and the source says so   | the database frame, then `limited`            |
 * | one cook's authored foods never reach another cook's answer             | caller B's food absent from A's frame         |
 * | a picked remote food becomes one root, however many picks race          | one root, one crosswalk row                   |
 * | a picked food is then held, and hidden from the next answer             | the hit gone from the source frame            |
 * | a held food the answer does not show is a search gap, counted            | `search_gap` row, then counted again          |
 * | a hit a named catalog root holding a record answers is hidden, and a gap | the hit gone, a `search_gap` row on the root  |
 * | a pick that leases a placeholder first leaves the racing drain nothing    | one source on the root, one fetch in all      |
 * | a drain that claims a placeholder first leaves the racing pick busy       | one source on the root, the pick fetched nothing |
 */
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { InMemoryPublisher } from '@kitchensink/messaging';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { REQUESTER_SOURCE_BUDGET_PER_HOUR } from '../../src/common/throttle/throttle.config.js';
import * as schema from '../../src/db/schema/index.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { SourceBackoffDao } from '../../src/foods/dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from '../../src/foods/dao/sourceCallLog.dao.js';
import { adoptRemoteFoodResponseSchema, foodErrorSchema } from '../../src/foods/foods.schema.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { progressiveSearchFrameSchema, type ProgressiveSearchFrame } from '../../src/foods/progressiveSearch.schema.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { createSourceRegistry } from '../../src/sources/sourceRegistry.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { startSearchEdgeStandIn, type SearchEdgeStandIn } from '../support/searchEdgeStandIn.js';
import { searchFunctionDouble } from '../support/searchFunctionDouble.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';
const clerk = generateClerkKeypair();
const COOK_A = '01J9ZK8N7QF3B2X4M6T0V5C2AA';
const COOK_B = '01J9ZK8N7QF3B2X4M6T0V5C2BB';
const COOK_C = '01J9ZK8N7QF3B2X4M6T0V5C2CC';
const tokenA = mintToken(clerk.privateKeyPem, { sub: 'user_progressive_a', externalId: COOK_A, azp: APP_AZP });
const tokenB = mintToken(clerk.privateKeyPem, { sub: 'user_progressive_b', externalId: COOK_B, azp: APP_AZP });
const tokenC = mintToken(clerk.privateKeyPem, { sub: 'user_progressive_c', externalId: COOK_C, azp: APP_AZP });
const KEY_PAIR_ID = 'K2JCJMDEHXQW5F';
const { privateKey: SIGNING_KEY, publicKey: PUBLIC_PEM } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});
/** The settings this suite gives the app, unset again afterwards. */
const REMOTE_SEARCH_ENV = [
    'REMOTE_SEARCH_ORIGIN',
    'REMOTE_SEARCH_KEY_PAIR_ID',
    'REMOTE_SEARCH_SIGNING_KEY',
    'FOOD_REMOTE_REFERENCE_KEY',
];
const NEW_HIT = { externalKey: '900001', name: 'Kale chips, baked', lineageKey: null };
const HELD_HIT = { externalKey: '900002', name: 'Kale, raw', lineageKey: null };

describe('the progressive search and the remote pick (booted app, real Postgres)', () => {
    let app: BootedServiceApp;
    let pool: pg.Pool;
    let edge: SearchEdgeStandIn;
    let usda: UsdaStubServer;
    const origin = searchFunctionDouble();

    /**
     * Search as a cook and read every frame, split on the newline byte.
     *
     * @param token - The cook's token.
     * @param query - The term.
     * @returns The frames, each parsed by the contract.
     * @sideEffect One HTTP request.
     */
    async function search(token: string, query: string): Promise<ProgressiveSearchFrame[]> {
        const response = await fetch(
            `${app.baseUrl}/api/v1/foods/search/progressive?query=${encodeURIComponent(query)}`,
            {
                headers: { authorization: `Bearer ${token}` },
            },
        );

        expect(response.status).toBe(200);

        const text = await response.text();

        return text
            .trimEnd()
            .split('\n')
            .map((line) => progressiveSearchFrameSchema.parse(JSON.parse(line)));
    }

    /**
     * The one source frame of an answer.
     *
     * @param frames - The answer.
     * @returns Its source frame.
     */
    function sourceFrame(
        frames: readonly ProgressiveSearchFrame[],
    ): Extract<ProgressiveSearchFrame, { type: 'source' }> {
        const frame = frames.find((candidate) => candidate.type === 'source');

        if (frame?.type !== 'source') {
            throw new Error('expected a source frame');
        }

        return frame;
    }

    /**
     * How many source calls the shared window holds.
     *
     * @returns The count.
     * @sideEffect Reads `source_call_log`.
     */
    async function windowCalls(): Promise<number> {
        const counted = await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM source_call_log WHERE source = 'usda'",
        );

        return counted.rows[0]?.n ?? 0;
    }

    /**
     * Every search gap recorded.
     *
     * @returns The gaps.
     * @sideEffect Reads `search_gap`.
     */
    async function readGaps(): Promise<
        { query: string; external_key: string; food_id: string; occurrences: number }[]
    > {
        const gaps = await foodDb().asOwner((client) =>
            client.query<{ query: string; external_key: string; food_id: string; occurrences: number }>(
                'SELECT query, external_key, food_id, occurrences FROM search_gap',
            ),
        );

        return gaps.rows;
    }

    beforeAll(async () => {
        usda = await startUsdaStubServer();
        edge = await startSearchEdgeStandIn({
            origin: async (event) => origin.origin(event),
            publicKey: createPublicKey(PUBLIC_PEM),
            keyPairId: KEY_PAIR_ID,
        });
        process.env['USDA_API_BASE_URL'] = usda.baseUrl;
        process.env['REMOTE_SEARCH_ORIGIN'] = edge.origin;
        process.env['REMOTE_SEARCH_KEY_PAIR_ID'] = KEY_PAIR_ID;
        process.env['REMOTE_SEARCH_SIGNING_KEY'] = SIGNING_KEY;
        process.env['FOOD_REMOTE_REFERENCE_KEY'] = randomBytes(32).toString('base64url');
        app = await bootFoodApp({ clerkJwtKey: clerk.publicKeyPem, authorizedParties: [APP_AZP] });
        pool = new pg.Pool({ connectionString: foodDb().appUrl, max: 4 });
    });

    afterAll(async () => {
        await app?.close();
        await pool?.end();
        await edge?.close();
        await usda?.close();

        for (const name of REMOTE_SEARCH_ENV) {
            Reflect.deleteProperty(process.env, name);
        }
    });

    beforeEach(async () => {
        await foodDb().truncate();
        edge.clear();
        usda.reset();
        usda.mode = 'hits';
        origin.mode = { kind: 'found', items: [NEW_HIT] };
        origin.sourceCalls.length = 0;
    });

    it('⛔ spends the shared window on a miss, and nothing on the same search answered from the cache', async () => {
        await search(tokenA, 'kale');

        expect(await windowCalls()).toBe(1);

        await search(tokenB, 'kale');

        expect(await windowCalls()).toBe(1);
        expect(origin.sourceCalls).toStrictEqual(['kale']);
    });

    it('gives a cook at their limit our database’s answer, then says the source is their limit', async () => {
        await makeCatalogFood(pool, { name: 'collard greens' });
        await pool.query(
            `INSERT INTO requester_source_budget (requester_id, spent, window_ends_at)
             VALUES ($1, $2, now() + interval '20 minutes')`,
            [COOK_C, REQUESTER_SOURCE_BUDGET_PER_HOUR],
        );

        const frames = await search(tokenC, 'collard greens');

        expect(frames.map((frame) => frame.type)).toStrictEqual(['database', 'source', 'complete']);
        expect(frames[0]).toMatchObject({ catalog: { outcome: 'answered', results: [{ name: 'collard greens' }] } });

        const frame = sourceFrame(frames);

        expect(frame.outcome).toBe('limited');
        expect(frame.outcome === 'limited' && frame.retryAfterSeconds).toBeGreaterThan(1_100);
        expect(await windowCalls()).toBe(0);
    });

    it('⛔ never shows one cook’s authored food in another cook’s answer', async () => {
        await makeCatalogFood(pool, { name: 'kale salad', userId: COOK_B });

        const forA = await search(tokenA, 'kale salad');
        const forB = await search(tokenB, 'kale salad');

        expect(forA[0]).toMatchObject({ authored: { outcome: 'answered', results: [] } });
        expect(forB[0]).toMatchObject({ authored: { outcome: 'answered', results: [{ name: 'kale salad' }] } });
    });

    it('makes a picked remote food one root, then holds it and hides it from the next answer', async () => {
        const hit = sourceFrame(await search(tokenA, 'kale'));

        if (hit.outcome !== 'answered') {
            throw new Error('expected an answered source');
        }

        expect(hit.items.map((item) => item.name)).toStrictEqual(['Kale chips, baked']);

        const reference = hit.items[0]?.reference ?? '';
        const picks = await Promise.all(
            Array.from({ length: 6 }, async (_, index) =>
                callFoodApi(app.baseUrl, 'POST', '/api/v1/foods/remote/adopt', {
                    token: index % 2 === 0 ? tokenA : tokenB,
                    body: { reference },
                }),
            ),
        );

        expect(picks.map((pick) => pick.status)).toStrictEqual([200, 200, 200, 200, 200, 200]);
        expect(new Set(picks.map((pick) => JSON.stringify(pick.body))).size).toBe(1);

        const roots = await pool.query<{ id: string; name: string; status: string }>(
            `SELECT f.id, f.name, f.status::text AS status FROM food f
               JOIN food_sources fs ON fs.item_id = f.item_id
              WHERE fs.source = 'usda' AND fs.external_key = '900001'`,
        );

        expect(roots.rows).toStrictEqual([
            {
                id: adoptRemoteFoodResponseSchema.parse(picks[0]?.body).id,
                name: 'Kale chips, baked',
                status: 'RESOLVED',
            },
        ]);
        expect(usda.requests.filter((path) => path.endsWith('/food/900001')).length).toBeGreaterThanOrEqual(1);

        const after = sourceFrame(await search(tokenB, 'kale'));

        expect(after).toStrictEqual({ type: 'source', source: 'usda', outcome: 'answered', items: [] });
    });

    it('records a held food the answer does not show as a search gap, and counts each search that meets it', async () => {
        const borecole = await makeCatalogFood(pool, { name: 'borecole' });

        await pool.query(
            `INSERT INTO food_sources (id, item_id, source, external_key) VALUES ('fs-borecole', $1, 'usda', '900002')`,
            [borecole.itemId],
        );
        origin.mode = { kind: 'found', items: [HELD_HIT, NEW_HIT] };

        const first = sourceFrame(await search(tokenA, 'kale'));

        expect(first.outcome === 'answered' && first.items.map((item) => item.name)).toStrictEqual([
            'Kale chips, baked',
        ]);

        await search(tokenB, 'kale');

        // A search's gaps are recorded after its body ends (ADR-0055 point 4), so the second may land just after.
        await expect
            .poll(readGaps)
            .toStrictEqual([{ query: 'kale', external_key: '900002', food_id: borecole.id, occurrences: 2 }]);
    });

    it('⛔ hides a hit whose name a catalog root holding a record carries, and records it as a gap (R66)', async () => {
        const chips = await makeCatalogFood(pool, { name: NEW_HIT.name });

        expect(sourceFrame(await search(tokenA, 'savory snack'))).toStrictEqual({
            type: 'source',
            source: 'usda',
            outcome: 'answered',
            items: [],
        });

        await expect
            .poll(readGaps)
            .toStrictEqual([{ query: 'savory snack', external_key: '900001', food_id: chips.id, occurrences: 1 }]);
    });
    /**
     * A cook picks a remote food whose name a placeholder root already carries while the worker drains that root (the
     * lead's ruling on S7.6). The pick completes the root rather than binding the cook's line to a root with no data,
     * and the two never both fetch for it: whichever holds the root's queue row first does the work, and the other
     * spends nothing. The worker is composed as `worker/main.ts` composes it, on the worker lane, over its own pool.
     */
    describe('a pick racing a drain on the placeholder that carries its name', () => {
        let workerPool: pg.Pool;
        let consumer: FoodConsumerService;

        beforeAll(() => {
            workerPool = new pg.Pool({ connectionString: foodDb().appUrl, max: 4 });

            const db = drizzle(workerPool, { schema });
            const registry = createSourceRegistry({
                lane: 'worker',
                admission: new RollingWindowLimiter(new SourceCallLogDao(db), {}),
                blocks: new SourceBackoffDao(db),
                metrics: { recordSourceRateLimit: () => undefined },
            });

            consumer = new FoodConsumerService({
                foodDao: new FoodDao(db),
                sources: new FoodSourcesDao(db),
                queue: new FetchQueueDao(db),
                registry,
                merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
                events: new FoodEventEmitter(new InMemoryPublisher()),
                logger: new SilentWorkerLogger(),
            });
        });

        afterAll(async () => {
            await workerPool?.end();
        });

        /**
         * Add the hit's name by name, as another cook would, leaving a queued placeholder root.
         *
         * @returns The root's id.
         * @sideEffect One HTTP request.
         */
        async function placeholder(): Promise<string> {
            const added = await callFoodApi(app.baseUrl, 'POST', '/api/v1/foods', {
                token: tokenB,
                body: { name: NEW_HIT.name },
            });

            expect(added.status).toBe(202);

            return (added.body as { id: string }).id;
        }

        /**
         * Search as cook A and take the new hit's reference.
         *
         * @returns The reference.
         * @sideEffect One HTTP request.
         */
        async function newHitReference(): Promise<string> {
            const frame = sourceFrame(await search(tokenA, 'kale'));

            if (frame.outcome !== 'answered' || frame.items[0] === undefined) {
                throw new Error('expected the new hit');
            }

            return frame.items[0].reference;
        }

        /**
         * Pick a hit as cook A.
         *
         * @param reference - The hit's reference.
         * @returns The answer.
         * @sideEffect One HTTP request.
         */
        async function pick(reference: string): Promise<Awaited<ReturnType<typeof callFoodApi>>> {
            return callFoodApi(app.baseUrl, 'POST', '/api/v1/foods/remote/adopt', {
                token: tokenA,
                body: { reference },
            });
        }

        /**
         * What the root holds once the race is over.
         *
         * @param id - The root.
         * @returns Its status, its crosswalk keys, and its queue and requester rows.
         * @sideEffect Reads the catalog and the queue.
         */
        async function rootAfter(id: string): Promise<{ status: string; keys: string[]; queued: number }> {
            const status = await pool.query<{ status: string }>(
                'SELECT status::text AS status FROM food WHERE id = $1',
                [id],
            );
            const keys = await pool.query<{ external_key: string }>(
                `SELECT fs.external_key FROM food_sources fs JOIN food f ON f.item_id = fs.item_id WHERE f.id = $1`,
                [id],
            );
            const queued = await pool.query<{ n: number }>(
                `SELECT (SELECT count(*) FROM fetch_queue WHERE food_id = $1)
                      + (SELECT count(*) FROM fetch_requesters WHERE food_id = $1) AS n`,
                [id],
            );

            return {
                status: status.rows[0]?.status ?? 'MISSING',
                keys: keys.rows.map((row) => row.external_key),
                queued: Number(queued.rows[0]?.n),
            };
        }

        /**
         * What a cook spent of their hourly source budget.
         *
         * @param requesterId - The cook.
         * @returns The calls spent; none for a cook with no budget row.
         * @sideEffect Reads `requester_source_budget`.
         */
        async function spentBy(requesterId: string): Promise<number> {
            const spent = await pool.query<{ spent: number }>(
                'SELECT spent FROM requester_source_budget WHERE requester_id = $1',
                [requesterId],
            );

            return spent.rows[0]?.spent ?? 0;
        }

        it('⛔ a pick that leases the root first leaves the drain nothing, and completes it with the one fetch', async () => {
            const root = await placeholder();
            const reference = await newHitReference();
            const fetching = usda.hold('/food/900001');
            const picked = pick(reference);

            await fetching.reached;
            await consumer.drain();

            expect(usda.requests).toStrictEqual(['/fdc/v1/food/900001']);

            fetching.release();

            const answer = await picked;

            expect(answer.status).toBe(200);
            expect(answer.body).toStrictEqual({ id: root });

            await consumer.drain();

            expect(await rootAfter(root)).toStrictEqual({ status: 'RESOLVED', keys: ['900001'], queued: 0 });
            expect(usda.requests).toStrictEqual(['/fdc/v1/food/900001']);
        });

        it('⛔ a drain that claims the root first leaves the pick busy, fetching nothing and spending nothing', async () => {
            const root = await placeholder();
            const reference = await newHitReference();

            usda.searchBody = {
                foods: [{ fdcId: 900001, description: NEW_HIT.name, dataType: 'SR Legacy' }],
                totalHits: 1,
            };

            const spentBeforePick = await spentBy(COOK_A);
            const searching = usda.hold('/foods/search');
            const drained = consumer.drain();

            await searching.reached;

            const busy = await pick(reference);

            expect(busy.status).toBe(503);
            expect(foodErrorSchema.parse(busy.body)).toMatchObject({ code: 'FETCH_UNAVAILABLE' });
            expect(busy.headers.get('retry-after')).toBe('5');
            expect(usda.requests).toStrictEqual(['/fdc/v1/foods/search']);

            searching.release();
            await drained;

            expect(await rootAfter(root)).toStrictEqual({ status: 'RESOLVED', keys: ['900001'], queued: 0 });

            expect(await spentBy(COOK_A)).toBe(spentBeforePick);

            const again = await pick(reference);

            expect(again.status).toBe(200);
            expect(again.body).toStrictEqual({ id: root });
            expect(usda.requests.filter((path) => path.startsWith('/fdc/v1/food/'))).toStrictEqual([]);
        });
    });
});
