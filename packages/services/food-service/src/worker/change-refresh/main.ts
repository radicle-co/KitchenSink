/**
 * Change-refresh Fargate **scheduled-task** entrypoint (T-170, MOD-020/ARCH-018). Wires a short-lived
 * `pg` pool, the canonical DAOs, the source-adapter registry (USDA wired), the per-source rolling-window
 * limiter, the candidate store, and the in-process {@link EnqueueEmitter}, runs ONE change-refresh pass
 * ({@link ChangeRefreshConsumer.runOnce}), then exits — the natural shape for a scheduled task that
 * yields to live demand rather than a long-lived loop.
 *
 * The EventBridge `IngestionScheduled` schedule → ECS `RunTask` target, its task definition, and the
 * `RunTask`/task-execution IAM roles are **infra/CDK (T-001c) and out of scope for this slice**; this
 * file is only the runnable application entry the scheduled task invokes. No AWS SDK is required to run
 * it — enqueues go through Postgres (`fetch_queue` + `pg_notify`), the same as the demand path.
 *
 * @sideEffect Opens Postgres connections, performs source re-fetches, and enqueues refresh rows.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { CandidateStore } from '../../foods/dao/food-candidates.dao.js';
import { FoodSourcesDao } from '../../foods/dao/food-sources.dao.js';
import { SourceCallLogDao } from '../../foods/dao/source-call-log.dao.js';
import { EnqueueEmitter } from '../../foods/enqueue.emitter.js';
import { foodPoolConfigFromEnv } from '../../database/pool-config.js';
import * as schema from '../../db/schema/index.js';
import { SourceAdapterRegistry } from '../../sources/food-source-adapter.js';
import { RollingWindowLimiter } from '../../sources/rolling-window-limiter.js';
import { UsdaSourceAdapter } from '../../sources/usda/usda.adapter.js';
import { UsdaApiClient } from '@kitchensink/usda-client';
import { ConsoleWorkerLogger } from '../worker-logger.js';
import { ChangeRefreshConsumer } from './change-refresh.consumer.js';

const { Pool } = pg;

/**
 * Bootstrap, run one change-refresh pass, and exit.
 *
 * @sideEffect Connects to Postgres, re-fetches changed items, enqueues refresh rows, then closes.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger();
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: 5 });
    const db = drizzle(pool, { schema });

    const apiKey = process.env['USDA_API_KEY'];

    if (!apiKey) {
        throw new Error('USDA_API_KEY is required to run the change-refresh task');
    }

    const registry = new SourceAdapterRegistry();
    registry.register(new UsdaSourceAdapter(new UsdaApiClient({ apiKey })));

    const ttlDays = Number(process.env['FOOD_UNRESOLVED_TTL_DAYS'] ?? 30);
    const consumer = new ChangeRefreshConsumer({
        sources: new FoodSourcesDao(db),
        candidates: new CandidateStore(db),
        registry,
        limiter: new RollingWindowLimiter(new SourceCallLogDao(db)),
        enqueue: new EnqueueEmitter(pool),
        logger,
        unresolvedTtlDays: ttlDays,
    });

    try {
        const result = await consumer.runOnce();
        logger.info('change-refresh-complete', { ...result });
    } finally {
        await pool.end();
    }
}

void bootstrap().catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', message: 'change-refresh-bootstrap-failed', error: String(error) }));
    process.exitCode = 1;
});
