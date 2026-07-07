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
import { readFileSync } from 'node:fs';
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
import { UsdaApiClient } from '@commise/clients-usda';
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
 * The container's actual CPU allowance (vCPUs). `availableParallelism()`/`os.cpus()` report the HOST's
 * cores, which on Fargate/K8s is NOT the task's CPU limit (a CFS quota) — a 0.25-vCPU task on an 8-core
 * host would read 8. So prefer the cgroup quota (cgroup v2 `cpu.max`, then v1 `cpu.cfs_quota_us`), and
 * fall back to `availableParallelism()` off-container (local dev / macOS, where the files are absent).
 *
 * @sideEffect Reads cgroup files under /sys/fs/cgroup.
 */
function containerCpus(): number {
    try {
        const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/); // cgroup v2

        if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0) {
            return Number(quota) / Number(period);
        }
    } catch {
        /* not cgroup v2 */
    }

    try {
        const quota = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim()); // cgroup v1
        const period = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim());

        if (quota > 0 && period > 0) {
            return quota / period;
        }
    } catch {
        /* not cgroup v1 */
    }

    return availableParallelism();
}

/**
 * How many foods the drainer processes concurrently. The fan-out is ~80% USDA network I/O, so a single
 * food leaves the CPU mostly idle — oversubscribe the task's vCPUs by `FOOD_WORKER_CONCURRENCY_PER_CPU`
 * (default 2). vCPUs come from {@link containerCpus} (sub-1-vCPU tasks round up to 1 logical slot), and
 * the result is clamped to [2, 8]. The upper bound is deliberately conservative: each concurrent food
 * issues ~2 USDA requests, so N-in-flight is ~2N simultaneous requests from one Fargate IP, and a higher
 * width drove USDA's response latency past the client timeout (self-inflicted timeouts → deferred foods).
 * `FOOD_WORKER_CONCURRENCY` overrides the whole computation. The rolling-window limiter still caps the
 * actual USDA call rate, so this only sets the burst width.
 */
function workerConcurrency(): number {
    const explicit = Number(process.env['FOOD_WORKER_CONCURRENCY']);

    if (Number.isInteger(explicit) && explicit > 0) {
        return explicit;
    }

    const perCpuRaw = Number(process.env['FOOD_WORKER_CONCURRENCY_PER_CPU'] ?? 2);
    const perCpu = Number.isFinite(perCpuRaw) && perCpuRaw > 0 ? perCpuRaw : 2;
    const cpus = Math.max(1, Math.round(containerCpus()));

    return Math.max(2, Math.min(8, Math.round(cpus * perCpu)));
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
