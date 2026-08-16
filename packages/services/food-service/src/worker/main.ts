/**
 * Fargate fan-out/merge consumer entrypoint (MOD-004). Wires the long-lived `pg` pool, the canonical
 * DAOs, the source-adapter registry (USDA wired), the per-source rolling-window limiter, the
 * merge/persist seam, and the completion-event emitter into a {@link WorkerRuntime}, then starts the
 * single-drainer loop. The actual EventBridge put is deliberately NOT required here — the bootstrap
 * uses the no-AWS `ConsolePublisher` fallback so the worker runs without an AWS dependency; the
 * real EventBridge bus is wired with the infra slice.
 *
 * @sideEffect Opens Postgres connections, acquires the advisory lock, and begins draining.
 */
import { availableParallelism } from 'node:os';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { ConsolePublisher } from '@kitchensink/messaging';
import { FoodEventEmitter } from '../events/FoodEventEmitter.js';
import { AdminMetricsDao } from '../foods/admin/adminMetrics.dao.js';
import { FetchQueueDao } from '../foods/dao/fetchQueue.dao.js';
import { FoodDao } from '../foods/dao/food.dao.js';
import { FoodSourcesDao } from '../foods/dao/foodSources.dao.js';
import { SourceCallLogDao } from '../foods/dao/sourceCallLog.dao.js';
import { GoldenRecordMergeEngine } from '../foods/merge/mergeEngine.js';
import { MergeAndPersistService } from '../foods/merge/mergeAndPersist.service.js';
import { FoodMetrics } from '../observability/emfMetrics.js';
import { foodPoolConfigFromEnv } from '../database/poolConfig.js';
import * as schema from '../db/schema/index.js';
import { RollingWindowLimiter } from '../sources/RollingWindowLimiter.js';
import { createUsdaSourceRegistry } from '../sources/usda/usdaRegistry.js';
import { containerCpus, workerConcurrency } from './concurrency.js';
import { FoodConsumerService } from './foodConsumer.service.js';
import { ConsoleWorkerLogger } from './ConsoleWorkerLogger.js';
import { WorkerRuntime } from './WorkerRuntime.js';

const { Pool } = pg;

/**
 * Bootstrap and start the consumer.
 *
 * @sideEffect Connects to Postgres, registers signal handlers, and runs the drain loop.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger();
    // A pool large enough to back the concurrent drainer (each in-flight food may hold a connection).
    const concurrency = workerConcurrency();
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: Math.max(10, concurrency + 2) });
    const db = drizzle(pool, { schema });

    // Source credentials (USDA_API_KEY) and the adapter's base URL (USDA_API_BASE_URL) are resolved by the
    // ONE registry factory through the ONE validated reader, so this entrypoint cannot wire a differently
    // configured adapter than the API or the change-refresh task.
    const registry = createUsdaSourceRegistry();

    const metrics = new FoodMetrics();
    const queue = new FetchQueueDao(db);
    const consumer = new FoodConsumerService({
        foodDao: new FoodDao(db),
        sources: new FoodSourcesDao(db),
        queue,
        registry,
        // The limiter resolves FOOD_SOURCE_RATE_LIMIT_PER_HOUR itself, so this worker — which is what
        // consults isPaused — cannot drift from the cap the API and the change-refresh task charge.
        limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
        merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        events: new FoodEventEmitter(new ConsolePublisher(), undefined, (error, kind) =>
            logger.warn('message-publish-failed', { kind, error: String(error) }),
        ),
        logger,
        metrics,
        concurrency,
    });

    logger.info('worker-concurrency', {
        concurrency,
        containerCpus: Number(containerCpus().toFixed(2)),
        hostCpus: availableParallelism(),
    });

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
