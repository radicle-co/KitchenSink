/**
 * USDA bulk-seed **admin/CLI task** entrypoint (ingredient-search plan §2 Stage 1).
 *
 * Wires a short-lived `pg` pool, the canonical DAOs, and the merge/persist seam, streams an extracted
 * USDA bulk directory through {@link streamBulkCandidates} into {@link BulkSeedService}, then exits.
 *
 * ── WHY A CLI TASK AND NOT AN API ROUTE ─────────────────────────────────────────────────────────────
 * The bulk datasets are HTTP **downloads**, not API calls — nothing here touches the rate-limited USDA
 * API, so the import consumes ZERO of the shared 1,000/hr per-IP quota. Exposing an ~8k-row, minutes-long
 * import as a request/response endpoint would only add a timeout, an auth surface, and a way to trigger it
 * twice concurrently. It runs as an operator-invoked task (locally, or as a one-off ECS `RunTask` on the
 * existing food task definition), the same shape as the change-refresh scheduled task.
 *
 * Usage (see `README.md` in this directory for the full runbook, including the download step):
 *
 *   DATABASE_URL=postgres://… npm run seed:usda-bulk --workspace=packages/services/food-service -- \
 *       --dir ./tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 [--limit 50]
 *
 * Exit code is non-zero when ANY candidate failed, so a CI/operator invocation cannot mistake a partial
 * import for a clean one. The import is idempotent, so the remedy is always "fix the cause and re-run".
 *
 * @sideEffect Opens Postgres connections, reads local files, and writes golden records.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { foodPoolConfigFromEnv } from '../../database/poolConfig.js';
import * as schema from '../../db/schema/index.js';
import { SourceAdapterRegistry } from '../../sources/foodSourceAdapter.js';
import { streamBulkCandidates } from '../../sources/usda/bulk/usdaBulk.reader.js';
import { ConsoleWorkerLogger } from '../../worker/workerLogger.js';
import { FoodDao } from '../dao/food.dao.js';
import { FoodSourcesDao } from '../dao/foodSources.dao.js';
import { GoldenRecordMergeEngine } from '../merge/mergeEngine.js';
import { MergeAndPersistService } from '../merge/mergeAndPersist.service.js';
import { BulkSeedService } from './bulkSeed.service.js';
import { parseSeedArgs, take } from './seedCli.js';

const { Pool } = pg;

/**
 * Bootstrap, run one bulk-seed import, and exit.
 *
 * @sideEffect Connects to Postgres, reads the bulk CSVs, writes golden records, then closes the pool.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger('food-bulk-seed');
    const options = parseSeedArgs(process.argv.slice(2));
    // A small pool: the import is deliberately sequential (each food runs one transaction that takes the
    // per-name advisory lock and touches the shared nutrient dictionary), so extra connections buy only
    // contention. `max: 2` leaves one spare for the pool's own bookkeeping.
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: 2 });
    const db = drizzle(pool, { schema });

    const seeder = new BulkSeedService({
        foods: new FoodDao(db),
        sources: new FoodSourcesDao(db),
        persist: new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry())),
        logger,
    });

    logger.info('bulk-seed-starting', { dir: options.dir, limit: options.limit ?? null });

    try {
        const result = await seeder.seed(take(streamBulkCandidates({ dir: options.dir, logger }), options.limit));

        if (result.failed > 0) {
            // Surface a partial import as a failure: the run is idempotent, so re-running after fixing the
            // cause is always safe, and a silent "completed with failures" is how a half-seeded catalog
            // reaches production.
            process.exitCode = 1;
        }
    } finally {
        await pool.end();
    }
}

void bootstrap().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            level: 'error',
            component: 'food-bulk-seed',
            message: 'bulk-seed-bootstrap-failed',
            error: error instanceof Error ? error.message : String(error),
        }),
    );
    process.exitCode = 1;
});
