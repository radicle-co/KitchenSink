/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): every caller through the REAL client, the REAL rate-limited transport, the REAL
 * limiter and block ledger, on a real Postgres, against a loopback USDA (ADR-0053 §3, §4, §5; plan U27):
 *
 * - at the ceiling, an item fetch on the API's interactive lane is refused busy, the worker defers the whole row, and
 *   change-refresh stops its scan — and the stand-in USDA receives NO request, which is the assertion that fails if
 *   admission is bypassed;
 * - a 503 blocks the source for its declared `outageBlockSeconds` (USDA: 60), never its hour-long breach block, and
 *   the next caller is refused without a request.
 *
 * Each caller is composed exactly as its composition root composes it: `createSourceRegistry` on the caller's lane.
 * The interactive caller is the API registry's item fetch, the call the remote pick and resolve make; it replaced the
 * live search when plan 002 S7.9 deleted that route. How the pick answers each refusal is
 * `tests/remoteAdopt.integration.test.ts`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPublisher } from '@kitchensink/messaging';

import * as schema from '../../src/db/schema/index.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { SearchGapDao } from '../../src/foods/dao/searchGap.dao.js';
import { SourceBackoffDao } from '../../src/foods/dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from '../../src/foods/dao/sourceCallLog.dao.js';
import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { makeMergeCandidate } from '../../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { isSourceApiError, isSourceBusyError } from '../../src/sources/foodSource.errors.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { createSourceRegistry } from '../../src/sources/sourceRegistry.js';
import type { SourceCallChannel } from '../../src/sources/transport/transportPorts.js';
import { ChangeRefreshConsumer } from '../../src/worker/change-refresh/changeRefresh.consumer.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import { workerCatalogOf } from '../../src/worker/workerCatalog.js';
import { FoodMetrics } from '../../src/observability/emfMetrics.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { foodDb } from '../support/roleDb.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';
import { makeQueueRow } from '../__fixtures__/queueRow.js';
import { makeRequesterRow } from '../__fixtures__/requesterRow.js';

/** A real principal, so the worker's provenance check admits the row. */
const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** USDA lowered to 10 an hour for this suite, so its 90% ceiling is 9. */
const OVERRIDES = { usda: { requests: 10, windowSeconds: 3600 } } as const;
const CEILING = 9;

describe('every caller through the rate-limited transport (real Postgres, loopback USDA)', () => {
    let pool: pg.Pool;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    let upstream: UsdaStubServer;

    /**
     * The registry a composition root builds, on `lane`.
     *
     * @param lane - The caller's lane.
     * @returns The registry.
     */
    function registryOn(lane: SourceCallChannel): SourceAdapterRegistry {
        return createSourceRegistry({
            lane,
            admission: new RollingWindowLimiter(new SourceCallLogDao(db), OVERRIDES),
            blocks: new SourceBackoffDao(db),
            metrics: { recordSourceRateLimit: () => undefined },
        });
    }

    /** Fill USDA's window to its ceiling. */
    async function fillWindow(): Promise<void> {
        await pool.query(
            `INSERT INTO source_call_log (source, channel, called_at)
             SELECT 'usda', 'worker', now() FROM generate_series(1, $1::int)`,
            [CEILING],
        );
    }

    beforeAll(async () => {
        upstream = await startUsdaStubServer();
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['USDA_API_BASE_URL'] = upstream.baseUrl;
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        db = drizzle(pool, { schema });
    });

    afterAll(async () => {
        await pool?.end();
        await upstream?.close();
        delete process.env['USDA_API_BASE_URL'];
    });

    beforeEach(async () => {
        await foodDb().truncate();
        upstream.mode = 'hits';
        upstream.reset();
    });

    describe('at the ceiling', () => {
        it('an interactive item fetch is refused at the ceiling and sends USDA nothing', async () => {
            await fillWindow();

            const thrown = await registryOn('interactive')
                .adapterFor('usda')
                .fetchByKey('171688')
                .catch((error: unknown) => error);

            expect(isSourceBusyError(thrown) && thrown.reason).toBe('ceiling');
            expect(upstream.requests).toEqual([]);
        });

        it('the worker defers the whole row without consuming an attempt, and sends USDA nothing', async () => {
            const foodDao = new FoodDao(db);
            const queue = new FetchQueueDao(db);
            const { id } = await foodDao.createByName({ normalizedName: 'broccoli', displayName: 'broccoli' });
            await makeRequesterRow(db, { foodId: id, requesterId: REQUESTER });
            await makeQueueRow(db, id);
            await fillWindow();
            const registry = registryOn('worker');
            const consumer = new FoodConsumerService({
                foodDao,
                sources: new FoodSourcesDao(db),
                catalog: workerCatalogOf(db, new FoodMetrics(() => undefined)),
                queue,
                registry,
                merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
                events: new FoodEventEmitter(new InMemoryPublisher()),
                logger: new SilentWorkerLogger(),
            });

            expect(await consumer.processNext()).toBe('deferred');
            expect(await queue.getByFoodId(id)).toMatchObject({ status: 'pending', attempts: 0 });
            expect(upstream.requests).toEqual([]);
        });

        it('change-refresh stops its scan and sends USDA nothing', async () => {
            const foodDao = new FoodDao(db);
            const { id } = await foodDao.createByName({ normalizedName: 'broccoli', displayName: 'broccoli' });
            await new MergeAndPersistService(
                db,
                new GoldenRecordMergeEngine(new SourceAdapterRegistry()),
            ).resolveAndPersist({
                holders: [],
                foodId: id,
                candidates: [
                    makeMergeCandidate('usda', { externalKey: '171688', name: 'broccoli', itemVersion: 'v1' }),
                ],
            });
            await fillWindow();
            const consumer = new ChangeRefreshConsumer({
                sources: new FoodSourcesDao(db),
                candidates: new CandidateStore(db),
                registry: registryOn('worker'),
                limiter: new RollingWindowLimiter(new SourceCallLogDao(db), OVERRIDES),
                searchGaps: new SearchGapDao(db),
                enqueue: new EnqueueEmitter(pool),
                logger: new SilentWorkerLogger(),
            });

            const result = await consumer.runOnce();

            expect(result).toMatchObject({ scanned: 0, enqueued: 0 });
            expect(upstream.requests).toEqual([]);
        });
    });

    it('a 503 blocks USDA for its 60 s outage block, not its breach hour, and the next caller is refused unasked', async () => {
        upstream.mode = 'server-error';
        const usda = registryOn('interactive').adapterFor('usda');

        const first = await usda.fetchByKey('171688').catch((error: unknown) => error);

        expect(isSourceApiError(first) && first.statusCode).toBe(503);
        const { rows } = await pool.query<{ reason: string; seconds: number }>(
            `SELECT reason, extract(epoch FROM blocked_until - now())::float8 AS seconds FROM source_backoff`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.reason).toBe('unavailable');
        expect(rows[0]?.seconds).toBeGreaterThan(55);
        expect(rows[0]?.seconds).toBeLessThanOrEqual(60);

        upstream.mode = 'hits';
        upstream.reset();
        const second = await usda.fetchByKey('171688').catch((error: unknown) => error);

        expect(isSourceBusyError(second) && second.reason).toBe('blocked');
        expect(upstream.requests).toEqual([]);
    });

    it('below the ceiling, one item fetch is one admitted request on the interactive lane', async () => {
        const candidate = await registryOn('interactive').adapterFor('usda').fetchByKey('171688');

        expect(candidate.externalKey).toBe('171688');
        expect(upstream.requests.map((path) => path.endsWith('/food/171688'))).toStrictEqual([true]);
        const { rows } = await pool.query<{ channel: string }>(`SELECT channel FROM source_call_log`);
        expect(rows).toEqual([{ channel: 'interactive' }]);
    });
});
