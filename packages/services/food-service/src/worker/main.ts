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

import { ConsolePublisher, type MessagePublisher } from '@kitchensink/messaging';
import { DynamoPublisher } from '../events/DynamoPublisher.js';
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
import { RoutedWorkerLogger } from './RoutedWorkerLogger.js';
import { checkInQueueCheck, escalate } from '../observability/queueEscalation.js';
import { readOnlyCounts, runQueueCheck as runFoodQueueCheck } from './queueCheck.js';
import { WorkerRuntime } from './WorkerRuntime.js';

/**
 * Choose the substrate adapter for this process (plan U6).
 *
 * `MESSAGE_TABLE_NAME` is injected by the service stack, which resolves it from SSM at deploy time — from
 * this stage's own per-PR table, or from the base stage's. When it is absent (a local run, a unit test,
 * anything outside a deployed task) the worker falls back to `ConsolePublisher`, which is what keeps the
 * worker runnable with NO AWS dependency at all.
 *
 * The fallback is deliberately a fallback rather than a throw: a worker that refused to start without a
 * table would make the substrate a hard dependency of food resolution, and the substrate is a SIDE
 * CHANNEL — losing it must never stop food from resolving.
 *
 * @returns The DynamoDB adapter in a deployed stage, else the console one.
 * @sideEffect Reads `process.env`.
 */
function resolvePublisher(): MessagePublisher {
    const tableName = process.env['MESSAGE_TABLE_NAME'];

    return tableName === undefined || tableName === '' ? new ConsolePublisher() : new DynamoPublisher(tableName);
}

const { Pool } = pg;

/**
 * Bootstrap and start the consumer.
 *
 * @sideEffect Connects to Postgres, registers signal handlers, and runs the drain loop.
 */
async function bootstrap(): Promise<void> {
    const logger = new RoutedWorkerLogger();
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
        events: new FoodEventEmitter(resolvePublisher(), undefined, (error, kind) =>
            // ⛔ The ONLY signal a fire-and-forget publish ever produces. The producer does not await a
            // consumer and never sees a failure, so a swallowed error here is a message that silently
            // never existed — see the `publish` port's contract.
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
        metrics.recordFailedBacklog(backlog.failed);
        metrics.recordPendingAgeSeconds(pendingAge);
    };

    // ⛔ THE BACKSTOP (plan U13), on the reaper's own tick. Everything above reports on work this process is
    // DOING; this reports on work nothing is doing — a food left `PENDING` with no queue row, a claim that
    // outlived any plausible run — which is invisible to every metric in `emitMetricsSnapshot` because those
    // count what the drainer touched. And because it rides this process's timer, its SILENCE is the
    // drainer's dead-man signal: if this worker dies, the check-ins stop and the cron monitor names the
    // cause rather than leaving an operator to infer it from a backlog.
    //
    // ⚠️ Its own connection, not the pool: the check opens a `READ ONLY` transaction and holds it across the
    // read, and a pooled connection handed back mid-transaction is the classic way to leak transaction state
    // into whoever draws it next.
    // ⚠️ The same read `instrument.ts` uses for the Sentry environment, and deliberately the same default:
    // a worker whose stage disagreed with its own Sentry client would file escalations under one name and
    // check in under another.
    const stage = process.env['STAGE'] ?? 'dev';
    const checkSession = await pool.connect();

    const runQueueCheck = async (): Promise<void> => {
        await runFoodQueueCheck({
            stage,
            counts: async () =>
                readOnlyCounts({
                    query: async (text, params) => checkSession.query(text, params as unknown[]),
                    release: () => {
                        checkSession.release();
                    },
                }),
            escalate,
            checkIn: () => {
                checkInQueueCheck(stage);
            },
            now: () => new Date(),
        });
    };

    const lockSession = await pool.connect();
    const listenSession = await pool.connect();
    const runtime = new WorkerRuntime({
        lockSession,
        listenSession,
        consumer,
        queue,
        logger,
        emitMetricsSnapshot,
        runQueueCheck,
    });

    const shutdown = (): void => {
        void runtime
            .stop()
            .catch((error: unknown) => logger.error('shutdown-failed', { error: String(error) }))
            .finally(() => {
                lockSession.release();
                listenSession.release();
                // ⚠️ The backstop's session too. It is checked out for the process's whole life exactly as
                // the other two are, and leaving it out meant `pool.end()` below waited on a connection
                // nothing would hand back — a SIGTERM that hangs until ECS's grace period kills the task,
                // turning a clean drain into a forced stop on every deploy.
                checkSession.release();
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
