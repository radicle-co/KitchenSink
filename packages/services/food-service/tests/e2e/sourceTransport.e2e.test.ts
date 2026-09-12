/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): every caller through the REAL client, the REAL rate-limited transport, the REAL
 * limiter and block ledger, on a real Postgres, against a loopback USDA (ADR-0053 §3, §4, §5; plan U27):
 *
 * - at the ceiling, live search reports busy, the worker defers the whole row, and change-refresh stops its scan —
 *   and the stand-in USDA receives NO request, which is the assertion that fails if admission is bypassed;
 * - a 503 blocks the source for its declared `outageBlockSeconds` (USDA: 60), never its hour-long breach block, and
 *   the next caller is refused without a request.
 *
 * Each caller is composed exactly as its composition root composes it: `createSourceRegistry` on the caller's lane.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPublisher } from '@kitchensink/messaging';

import * as schema from '../../src/db/schema/index.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FetchRequestersDao } from '../../src/foods/dao/fetchRequesters.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { CandidateStore } from '../../src/foods/dao/foodCandidates.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { SourceBackoffDao } from '../../src/foods/dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from '../../src/foods/dao/sourceCallLog.dao.js';
import { EnqueueEmitter } from '../../src/foods/enqueue.emitter.js';
import { isFetchUnavailableError, isSourceUnavailableError } from '../../src/foods/foods.errors.js';
import { LiveFoodSearchService } from '../../src/foods/liveSearch.service.js';
import { makeMergeCandidate } from '../../src/foods/merge/__fixtures__/merge.fixtures.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { createSourceRegistry } from '../../src/sources/sourceRegistry.js';
import type { SourceCallChannel } from '../../src/sources/transport/RateLimitedTransport.js';
import { ChangeRefreshConsumer } from '../../src/worker/change-refresh/changeRefresh.consumer.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { makeCatalogOwnerReader } from '../support/ownerReader.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';

/** A real principal, so the worker's provenance check admits the row. */
const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** USDA lowered to 10 an hour for this suite, so its 90% ceiling is 9. */
const OVERRIDES = { usda: { requests: 10, windowSeconds: 3600 } } as const;
const CEILING = 9;

describe.skipIf(!hasTestDatabase)(
    'every caller through the rate-limited transport (real Postgres, loopback USDA)',
    () => {
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
            pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
            db = drizzle(pool, { schema });
        });

        afterAll(async () => {
            await pool?.end();
            await upstream?.close();
            delete process.env['USDA_API_BASE_URL'];
        });

        beforeEach(async () => {
            await foodE2eDb().truncate();
            upstream.mode = 'hits';
            upstream.reset();
        });

        describe('at the ceiling', () => {
            it('live search reports busy (503) and sends USDA nothing', async () => {
                await fillWindow();
                const service = new LiveFoodSearchService(registryOn('interactive'), makeCatalogOwnerReader(db));

                const thrown = await service.search('broccoli').catch((error: unknown) => error);

                expect(isFetchUnavailableError(thrown)).toBe(true);
                expect(upstream.requests).toEqual([]);
            });

            it('the worker defers the whole row without consuming an attempt, and sends USDA nothing', async () => {
                const foodDao = new FoodDao(db);
                const queue = new FetchQueueDao(db);
                const { id } = await foodDao.createByName({ normalizedName: 'broccoli', displayName: 'broccoli' });
                await new FetchRequestersDao(db).add({ foodId: id, requesterId: REQUESTER });
                await queue.enqueue(id);
                await fillWindow();
                const registry = registryOn('worker');
                const consumer = new FoodConsumerService({
                    foodDao,
                    sources: new FoodSourcesDao(db),
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
            const service = new LiveFoodSearchService(registryOn('interactive'), makeCatalogOwnerReader(db));

            const first = await service.search('broccoli').catch((error: unknown) => error);

            expect(isSourceUnavailableError(first)).toBe(true);
            const { rows } = await pool.query<{ reason: string; seconds: number }>(
                `SELECT reason, extract(epoch FROM blocked_until - now())::float8 AS seconds FROM source_backoff`,
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.reason).toBe('unavailable');
            expect(rows[0]?.seconds).toBeGreaterThan(55);
            expect(rows[0]?.seconds).toBeLessThanOrEqual(60);

            upstream.mode = 'hits';
            upstream.reset();
            const second = await service.search('broccoli').catch((error: unknown) => error);

            expect(isFetchUnavailableError(second)).toBe(true);
            expect(upstream.requests).toEqual([]);
        });

        it('below the ceiling, one search is one admitted request on the interactive lane', async () => {
            const service = new LiveFoodSearchService(registryOn('interactive'), makeCatalogOwnerReader(db));

            const response = await service.search('broccoli');

            expect(response.results.map((result) => result.name)).toEqual([
                'Broccoli, raw',
                'Broccoli, cooked, boiled',
            ]);
            expect(upstream.searches).toEqual(['broccoli']);
            const { rows } = await pool.query<{ channel: string }>(`SELECT channel FROM source_call_log`);
            expect(rows).toEqual([{ channel: 'interactive' }]);
        });
    },
);
