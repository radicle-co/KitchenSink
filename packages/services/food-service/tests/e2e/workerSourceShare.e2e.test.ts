/**
 * LOCAL e2e (CODING_STANDARDS §7.1a): the worker's share of the source window on a real Postgres (owner, 2026-10-02;
 * `WORKER_WINDOW_SHARE` in `sourceCeiling.ts`). Two worker consumers, each on its own pool as two tasks would be,
 * drain one real queue through the real client, the real rate-limited transport and the real limiter, against a
 * loopback USDA that has nothing for any name, so each drained food costs exactly one call:
 *
 * - racing each other, the two consumers spend exactly the worker's share of the window, and no more;
 * - every row they could not drain is pending again, with no attempt spent and its retry still ahead;
 * - a cook's calls then spend the rest of the window up to the ceiling, and the one after it is refused unasked;
 * - a cook's calls spent first do not shrink the worker's share, but the window's ceiling still binds both lanes;
 * - once the worker's calls leave the window, the deferred rows drain: bulk work is slowed, never refused.
 *
 * Each caller is composed as its composition root composes it: `createSourceRegistry` on the caller's lane. A cook's
 * call is the API registry's item fetch, the call the remote pick and resolve make; it replaced the live search when
 * plan 002 S7.9 deleted that route.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPublisher } from '@kitchensink/messaging';

import * as schema from '../../src/db/schema/index.js';
import { FoodEventEmitter } from '../../src/events/FoodEventEmitter.js';
import { FetchQueueDao } from '../../src/foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../../src/foods/dao/food.dao.js';
import { FoodSourcesDao } from '../../src/foods/dao/foodSources.dao.js';
import { SourceBackoffDao } from '../../src/foods/dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from '../../src/foods/dao/sourceCallLog.dao.js';
import { GoldenRecordMergeEngine } from '../../src/foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../../src/foods/merge/mergeAndPersist.service.js';
import { RollingWindowLimiter } from '../../src/sources/RollingWindowLimiter.js';
import { isSourceBusyError } from '../../src/sources/foodSource.errors.js';
import type { SourceAdapterRegistry } from '../../src/sources/SourceAdapterRegistry.js';
import { createSourceRegistry } from '../../src/sources/sourceRegistry.js';
import type { SourceCallChannel } from '../../src/sources/transport/transportPorts.js';
import { sourceCeiling, workerCeiling } from '../../src/sources/transport/sourceCeiling.js';
import { FoodConsumerService } from '../../src/worker/foodConsumer.service.js';
import { workerCatalogOf } from '../../src/worker/workerCatalog.js';
import { FoodMetrics } from '../../src/observability/emfMetrics.js';
import { SilentWorkerLogger } from '../../src/worker/SilentWorkerLogger.js';
import { foodDb } from '../support/roleDb.js';
import { startUsdaStubServer, type UsdaStubServer } from '../support/usdaStubServer.js';
import { makeQueueRow } from '../__fixtures__/queueRow.js';
import { makeRequesterRow } from '../__fixtures__/requesterRow.js';

/** A real principal, so the worker's provenance check admits each row. */
const REQUESTER = '01J9ZK8N7QF3B2X4M6T0V5C1AB';

/** USDA lowered to 15 calls in its own hour, so nothing ages out while a case runs. */
const OVERRIDES = { usda: { requests: 15, windowSeconds: 3600 } } as const;
const CEILING = sourceCeiling(OVERRIDES.usda.requests);
const WORKER_CEILING = workerCeiling(CEILING);

/** More foods than the worker may fetch in one window. */
const FOODS = WORKER_CEILING + 4;

/** One task's connection and the database client over it. */
interface Task {
    readonly pool: pg.Pool;
    readonly db: ReturnType<typeof drizzle<typeof schema>>;
}

/**
 * Open one task's pool as `food_app`.
 *
 * @returns The task.
 * @sideEffect Opens a pool.
 */
function openTask(): Task {
    const pool = new pg.Pool({ connectionString: foodDb().appUrl });

    return { pool, db: drizzle(pool, { schema }) };
}

/**
 * The registry a composition root builds on `lane`, over one task's connection.
 *
 * @param task - The task.
 * @param lane - The caller's lane.
 * @returns The registry.
 */
function registryOn(task: Task, lane: SourceCallChannel): SourceAdapterRegistry {
    return createSourceRegistry({
        lane,
        admission: new RollingWindowLimiter(new SourceCallLogDao(task.db), OVERRIDES),
        blocks: new SourceBackoffDao(task.db),
        metrics: { recordSourceRateLimit: () => undefined },
    });
}

/**
 * A worker consumer as `worker/main.ts` composes one, over one task's connection.
 *
 * @param task - The task.
 * @returns The consumer.
 */
function workerOn(task: Task): FoodConsumerService {
    const registry = registryOn(task, 'worker');

    return new FoodConsumerService({
        foodDao: new FoodDao(task.db),
        sources: new FoodSourcesDao(task.db),
        catalog: workerCatalogOf(task.db, new FoodMetrics(() => undefined)),
        queue: new FetchQueueDao(task.db),
        registry,
        merge: new MergeAndPersistService(task.db, new GoldenRecordMergeEngine(registry)),
        events: new FoodEventEmitter(new InMemoryPublisher()),
        logger: new SilentWorkerLogger(),
        concurrency: 3,
    });
}

/** The item a cook's fetch asks for. */
const FETCHED_ITEM = '171688';

/**
 * The window's calls, by lane.
 *
 * @param pool - A pool.
 * @returns The count per lane.
 * @sideEffect Reads `source_call_log`.
 */
async function callsByLane(pool: pg.Pool): Promise<Record<SourceCallChannel, number>> {
    const { rows } = await pool.query<{ channel: SourceCallChannel; n: number }>(
        `SELECT channel, count(*)::int AS n FROM source_call_log WHERE source = 'usda' GROUP BY channel`,
    );

    return {
        interactive: rows.find((row) => row.channel === 'interactive')?.n ?? 0,
        worker: rows.find((row) => row.channel === 'worker')?.n ?? 0,
    };
}

/**
 * The queue's rows, as the deferral leaves them.
 *
 * @param pool - A pool.
 * @returns Each row's status, attempts, and whether its retry is still ahead.
 * @sideEffect Reads `fetch_queue`.
 */
async function queueRows(pool: pg.Pool): Promise<{ status: string; attempts: number; ahead: boolean }[]> {
    const { rows } = await pool.query<{ status: string; attempts: number; ahead: boolean }>(
        `SELECT status, attempts, last_requested > now() AS ahead FROM fetch_queue ORDER BY food_id`,
    );

    return rows;
}

describe('the worker spends at most its share of the source window (real Postgres)', () => {
    let first: Task;
    let second: Task;
    let upstream: UsdaStubServer;

    beforeAll(async () => {
        upstream = await startUsdaStubServer();
        process.env['USDA_API_KEY'] = 'e2e-stub-key';
        process.env['USDA_API_BASE_URL'] = upstream.baseUrl;
        first = openTask();
        second = openTask();
    });

    afterAll(async () => {
        await first?.pool.end();
        await second?.pool.end();
        await upstream?.close();
        delete process.env['USDA_API_BASE_URL'];
    });

    /**
     * Make `count` item fetches on the API's interactive lane, each answered, then put the stub back to answering every
     * name with nothing, so each food the worker drains still costs exactly one call.
     *
     * @param task - The task whose registry fetches.
     * @param count - How many fetches.
     * @sideEffect Calls the stub, charging the window, and sets its mode.
     */
    async function fetchAsCook(task: Task, count: number): Promise<void> {
        const usda = registryOn(task, 'interactive').adapterFor('usda');

        upstream.mode = 'hits';

        try {
            for (let call = 0; call < count; call += 1) {
                await usda.fetchByKey(FETCHED_ITEM);
            }
        } finally {
            upstream.mode = 'empty';
        }
    }

    beforeEach(async () => {
        await foodDb().truncate();
        upstream.mode = 'empty';
        upstream.reset();

        const foods = new FoodDao(first.db);

        for (let index = 0; index < FOODS; index += 1) {
            const name = `share food ${String(index)}`;
            const { id } = await foods.createByName({ normalizedName: name, displayName: name });
            await makeRequesterRow(first.db, { foodId: id, requesterId: REQUESTER });
            await makeQueueRow(first.db, id);
        }
    });

    it('leaves the interactive lane a window to spend: the worker stops below the ceiling', () => {
        expect(WORKER_CEILING).toBeGreaterThan(0);
        expect(WORKER_CEILING).toBeLessThan(CEILING);
    });

    it('two racing consumers spend exactly the worker’s share, and every row left over waits unharmed', async () => {
        await Promise.all([workerOn(first).drain(), workerOn(second).drain()]);

        expect(await callsByLane(first.pool)).toEqual({ interactive: 0, worker: WORKER_CEILING });
        expect(upstream.searches).toHaveLength(WORKER_CEILING);

        const rows = await queueRows(first.pool);
        const waiting = rows.filter((row) => row.status === 'pending');

        expect(rows.filter((row) => row.status === 'tombstone')).toHaveLength(WORKER_CEILING);
        expect(waiting).toHaveLength(FOODS - WORKER_CEILING);
        expect(waiting.every((row) => row.attempts === 0 && row.ahead)).toBe(true);
    });

    it('lets a cook’s calls spend the rest of the window up to the ceiling, then refuses the next unasked', async () => {
        await Promise.all([workerOn(first).drain(), workerOn(second).drain()]);
        upstream.reset();

        await fetchAsCook(second, CEILING - WORKER_CEILING);

        const refused = await registryOn(second, 'interactive')
            .adapterFor('usda')
            .fetchByKey(FETCHED_ITEM)
            .catch((error: unknown) => error);

        expect(isSourceBusyError(refused) && refused.reason).toBe('ceiling');
        expect(upstream.requests).toHaveLength(CEILING - WORKER_CEILING);
        expect(await callsByLane(first.pool)).toEqual({
            interactive: CEILING - WORKER_CEILING,
            worker: WORKER_CEILING,
        });
    });

    it('lets the worker spend its whole share after a cook’s calls spent the rest of the window first', async () => {
        await fetchAsCook(second, CEILING - WORKER_CEILING);

        await Promise.all([workerOn(first).drain(), workerOn(second).drain()]);

        expect(await callsByLane(first.pool)).toEqual({
            interactive: CEILING - WORKER_CEILING,
            worker: WORKER_CEILING,
        });
    });

    it('leaves the worker only what the ceiling allows once a cook’s calls spend past their part', async () => {
        const cookCalls = CEILING - WORKER_CEILING + 2;

        await fetchAsCook(second, cookCalls);

        await Promise.all([workerOn(first).drain(), workerOn(second).drain()]);

        expect(await callsByLane(first.pool)).toEqual({ interactive: cookCalls, worker: CEILING - cookCalls });
        expect((await queueRows(first.pool)).filter((row) => row.status === 'pending')).toHaveLength(
            FOODS - (CEILING - cookCalls),
        );
    });

    it('drains the deferred rows once the worker’s calls have left the window', async () => {
        await Promise.all([workerOn(first).drain(), workerOn(second).drain()]);
        // An hour later, by moving the past rather than waiting: the window's calls age out and the deferred rows'
        // retry time arrives.
        await first.pool.query(`UPDATE source_call_log SET called_at = called_at - interval '3601 seconds'`);
        await first.pool.query(`UPDATE fetch_queue SET last_requested = now() WHERE status = 'pending'`);

        await workerOn(first).drain();

        expect((await queueRows(first.pool)).every((row) => row.status === 'tombstone')).toBe(true);
        expect(upstream.searches).toHaveLength(FOODS);
    });
});
