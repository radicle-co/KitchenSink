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
import * as schema from '../db/schema/index.js';
import { SourceAdapterRegistry } from '../sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../sources/rolling-window-limiter.js';
import { UsdaSourceAdapter } from '../sources/usda/usda.adapter.js';
import { UsdaApiClient } from '@kitchensink/usda-client';
import { FoodConsumerService } from './food-consumer.service.js';
import { ConsoleWorkerLogger } from './worker-logger.js';
import { WorkerRuntime } from './worker-runtime.js';

const { Pool } = pg;

/**
 * Build the Postgres connection string from the environment (`DATABASE_URL` or the discrete `DB_*`
 * parts). Mirrors `DatabaseModule.buildConnectionString` (which is not exported).
 *
 * @returns A `postgresql://` connection string.
 * @throws {Error} when neither `DATABASE_URL` nor a complete `DB_*` set is present.
 */
function buildConnectionString(): string {
    const url = process.env['DATABASE_URL'];

    if (url) {
        return url;
    }

    const host = process.env['DB_HOST'];
    const port = process.env['DB_PORT'];
    const database = process.env['DB_NAME'];
    const user = process.env['DB_USERNAME'];
    const password = process.env['DB_PASSWORD'];

    if (!host || !port || !database || !user || !password) {
        throw new Error(
            'Missing database configuration. Provide DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD.',
        );
    }

    return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
}

/**
 * Bootstrap and start the consumer.
 *
 * @sideEffect Connects to Postgres, registers signal handlers, and runs the drain loop.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger();
    const pool = new Pool({ connectionString: buildConnectionString(), max: 10 });
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
        limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
        merge: new MergeAndPersistService(db, new GoldenRecordMergeEngine(registry)),
        events: new FoodEventEmitter(new ConsoleEventBus(), undefined, (error, detailType) =>
            logger.warn('event-bus-put-failed', { detailType, error: String(error) }),
        ),
        logger,
        metrics,
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
