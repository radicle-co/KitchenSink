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

import { CandidateStore } from '../../foods/dao/foodCandidates.dao.js';
import { FoodSourcesDao } from '../../foods/dao/foodSources.dao.js';
import { SearchGapDao } from '../../foods/dao/searchGap.dao.js';
import { SourceBackoffDao } from '../../foods/dao/sourceBackoff.dao.js';
import { SourceCallLogDao } from '../../foods/dao/sourceCallLog.dao.js';
import { EnqueueEmitter } from '../../foods/enqueue.emitter.js';
import { foodPoolConfigFromEnv } from '../../database/poolConfig.js';
import * as schema from '../../db/schema/index.js';
import { RollingWindowLimiter } from '../../sources/RollingWindowLimiter.js';
import { createSourceRegistry } from '../../sources/sourceRegistry.js';
import { RoutedWorkerLogger } from '../RoutedWorkerLogger.js';
import { ChangeRefreshConsumer } from './changeRefresh.consumer.js';

const { Pool } = pg;

/**
 * Bootstrap, run one change-refresh pass, and exit.
 *
 * @sideEffect Connects to Postgres, re-fetches changed items, enqueues refresh rows, then closes.
 */
async function bootstrap(): Promise<void> {
    const logger = new RoutedWorkerLogger();
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: 5 });
    const db = drizzle(pool, { schema });

    // The limiter resolves FOOD_SOURCE_LIMIT_OVERRIDES itself; the ONE registry factory admits every call through
    // it on the WORKER lane — see the note in `worker/main.ts`.
    const limiter = new RollingWindowLimiter(new SourceCallLogDao(db));
    const registry = createSourceRegistry({ lane: 'worker', admission: limiter, blocks: new SourceBackoffDao(db) });

    const consumer = new ChangeRefreshConsumer({
        sources: new FoodSourcesDao(db),
        candidates: new CandidateStore(db),
        registry,
        // The UNRESOLVED-candidate TTL (FOOD_UNRESOLVED_TTL_DAYS) is resolved through the ONE validated reader by
        // the unit that uses it, so this scheduled task cannot sweep on a stale or NaN TTL. The limiter is here for
        // its ledger prune, which this task runs at the start of every pass.
        limiter,
        searchGaps: new SearchGapDao(db),
        enqueue: new EnqueueEmitter(pool),
        logger,
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
