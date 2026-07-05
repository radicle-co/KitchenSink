/**
 * Fargate fan-out/merge consumer entrypoint (MOD-004). Wires the long-lived `pg` pool, the canonical
 * DAOs, the source-adapter registry (USDA wired), the per-source rolling-window limiter, the
 * merge/persist seam, and the completion-event emitter into a {@link WorkerRuntime}, then starts the
 * single-drainer loop. The actual EventBridge put is deliberately NOT required here — the bootstrap
 * uses the no-AWS {@link ConsoleEventBus} fallback so the worker runs without an AWS dependency; the
 * real EventBridge bus is wired with the infra slice.
 *
 * @sideEffect Opens Postgres connections, acquires the advisory lock, and begins draining.
 */
import { availableParallelism } from 'node:os';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { ConsoleEventBus, FoodEventEmitter } from '../events/food-event-emitter.js';
import { AdminMetricsDao } from '../foods/admin/admin-metrics.dao.js';
import { FetchQueueDao } from '../foods/dao/fetch-queue.dao.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { FoodSourcesDao } from '../foods/dao/food-sources.dao.js';
import { SourceCallLogDao } from '../foods/dao/source-call-log.dao.js';
import { GoldenRecordMergeEngine } from '../foods/merge/merge-engine.js';
import { MergeAndPersistService } from '../foods/merge/merge-and-persist.service.js';
import { FoodMetrics } from '../observability/emf-metrics.js';
import { foodPoolConfigFromEnv } from '../database/pool-config.js';
import * as schema from '../db/schema/index.js';
import { SourceAdapterRegistry } from '../sources/food-source-adapter.js';
import { RollingWindowLimiter, sourceCapsFromEnv } from '../sources/rolling-window-limiter.js';
import { UsdaSourceAdapter } from '../sources/usda/usda.adapter.js';
import { UsdaApiClient } from '@kitchensink/usda-client';
import { FoodConsumerService } from './food-consumer.service.js';
import { ConsoleWorkerLogger } from './worker-logger.js';
import { WorkerRuntime } from './worker-runtime.js';

const { Pool } = pg;

/**
 * Bootstrap and start the consumer.
 *
 * @sideEffect Connects to Postgres, registers signal handlers, and runs the drain loop.
 */
/**
 * How many foods the drainer processes concurrently. The fan-out is ~80% USDA network I/O, so a single
 * food leaves a core mostly idle — we oversubscribe the task's vCPUs (`availableParallelism` is
 * container-aware, unlike a hard-coded number) by `FOOD_WORKER_CONCURRENCY_PER_CPU` (default 4), clamped
 * to [1, 16] so a large box doesn't burst USDA. `FOOD_WORKER_CONCURRENCY` overrides the whole computation.
 * The rolling-window limiter still caps the actual USDA call rate, so this only sets the burst width.
 */
function workerConcurrency(): number {
    const explicit = Number(process.env['FOOD_WORKER_CONCURRENCY']);

    if (Number.isInteger(explicit) && explicit > 0) {
        return explicit;
    }

    const perCpu = Number(process.env['FOOD_WORKER_CONCURRENCY_PER_CPU'] ?? 4);
    const scaled = availableParallelism() * (Number.isFinite(perCpu) && perCpu > 0 ? perCpu : 4);

    return Math.max(1, Math.min(16, Math.round(scaled)));
}

async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger();
    // A pool large enough to back the concurrent drainer (each in-flight food may hold a connection).
    const concurrency = workerConcurrency();
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: Math.max(10, concurrency + 2) });
    const db = drizzle(pool, { schema });

    const apiKey = process.env['USDA_API_KEY'];

    if (!apiKey) {
        throw new Error('USDA_API_KEY is required to run the food-fetch consumer');
    }

    const registry = new SourceAdapterRegistry();
    registry.register(new UsdaSourceAdapter(new UsdaApiClient({ apiKey })));

    const metrics = new FoodMetrics();
    const queue = new FetchQueueDao(db);
    const consumer = new FoodConsumerService({
        foodDao: new FoodDao(db),
        sources: new FoodSourcesDao(db),
        queue,
        registry,
        // Honor FOOD_SOURCE_RATE_LIMIT_PER_HOUR — the worker is what consults isPaused, so it MUST use the
        // same configured cap as the API (previously it silently used the 1,000 default).
        limiter: new RollingWindowLimiter(new SourceCallLogDao(db), { caps: sourceCapsFromEnv() }),
        merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        events: new FoodEventEmitter(new ConsoleEventBus(), undefined, (error, detailType) =>
            logger.warn('event-bus-put-failed', { detailType, error: String(error) }),
        ),
        logger,
        metrics,
        concurrency,
    });

    logger.info('worker-concurrency', { concurrency, vcpus: availableParallelism() });

    // T-181: a periodic operational-metrics snapshot (queue depth / backlog / tombstone / oldest-pending
    // age) emitted as EMF — reuses the admin operational-read DAO and the queue freshness signal. The
    // worker runtime invokes this best-effort on each reaper tick (and once at start).
    const adminMetrics = new AdminMetricsDao(db);

    const emitMetricsSnapshot = async (): Promise<void> => {
        const [depths, backlog, pendingAge] = await Promise.all([
            adminMetrics.queueDepths(),
            adminMetrics.backlog(),
            queue.pendingAgeSeconds(),
        ]);

        metrics.recordQueueDepth(depths.pending);
        metrics.recordInFlightLeases(depths.inFlight);
        metrics.recordTombstoneCount(depths.tombstone);
        metrics.recordUnresolvedBacklog(backlog.unresolved);
        metrics.recordPendingAgeSeconds(pendingAge);
    };

    const lockSession = await pool.connect();
    const listenSession = await pool.connect();
    const runtime = new WorkerRuntime({ lockSession, listenSession, consumer, queue, logger, emitMetricsSnapshot });

    const shutdown = (): void => {
        void runtime
            .stop()
            .catch((error: unknown) => logger.error('shutdown-failed', { error: String(error) }))
            .finally(() => {
                lockSession.release();
                listenSession.release();
                void pool.end();
            });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    const acquired = await runtime.start();
    logger.info(acquired ? 'consumer-draining' : 'consumer-standby', { acquired });
}

void bootstrap().catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', message: 'bootstrap-failed', error: String(error) }));
    process.exitCode = 1;
});
