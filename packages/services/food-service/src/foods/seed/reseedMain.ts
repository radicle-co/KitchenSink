/**
 * Entrypoint for the food-catalog RESEED (U12b). Wires one short-lived `pg` pool, the canonical DAOs and
 * the merge/persist seam, hands three adapters to {@link runCatalogReseed}, prints one JSON line, and
 * exits.
 *
 * Split from `reseedCli.ts` for the same reason `clearMain.ts` is split from `clearCli.ts` and `main.ts`
 * from `seedCli.ts`: the decision logic must be importable by a test WITHOUT importing a module whose
 * side effect is "connect to a database and start writing thousands of rows".
 *
 * ⛔ U12a RUNS FIRST. A reseed mints FRESH ULIDs, so every recipe-side `ingredients.food_id` must already
 * have been nulled and the old catalog cleared — see `README.md` in this directory for the ordered
 * runbook. This task cannot enforce that ordering the way the clear does (an unlinked recipe database and
 * a never-linked one are indistinguishable from here), which is exactly why the clear owns the check.
 *
 * ⚠️ The run reports `aliasesExpected: false` / `foodsWithAliases: 0` today, and that is the CORRECT
 * outcome, not a failure: the shipped roster enables Foundation + SR Legacy, which publish no curated
 * aliases. See `catalogDatasets.ts`.
 *
 * Usage:
 *
 *   STAGE=sandbox DATABASE_URL=postgres://…/kitchensink_food \
 *     npm run catalog:reseed --workspace=packages/services/food-service -- \
 *       --dir tmp/fdc/FoodData_Central_sr_legacy_food_csv_2018-04 --dry-run
 *   … same, then -- --confirm sandbox
 *
 * Exit code is non-zero on any refusal, unverified reseed, or connection failure, so a scripted
 * invocation cannot mistake "the guard said no" for "there was nothing to do".
 *
 * @sideEffect Opens Postgres connections, reads local files, and writes golden records.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { foodPoolConfigFromEnv } from '../../database/poolConfig.js';
import * as schema from '../../db/schema/index.js';
import { SourceAdapterRegistry } from '../../sources/SourceAdapterRegistry.js';
import { ConsoleWorkerLogger } from '../../worker/ConsoleWorkerLogger.js';
import { FoodDao } from '../dao/food.dao.js';
import { FoodSourcesDao } from '../dao/foodSources.dao.js';
import { GoldenRecordMergeEngine } from '../merge/mergeEngine.js';
import { MergeAndPersistService } from '../merge/mergeAndPersist.service.js';
import { BulkSeedService } from './bulkSeed.service.js';
import { enabledDataTypes } from './catalogDatasets.js';
import { describeDatabaseTarget } from './clearCli.js';
import { createBulkSourceReader, createCatalogInventory, parseReseedArgs, runCatalogReseed } from './reseedCli.js';

const { Pool } = pg;

/**
 * Bootstrap, run one reseed, and exit.
 *
 * @sideEffect Connects to Postgres, reads the bulk CSVs, writes golden records, then closes the pool.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger('food-catalog-reseed');
    const options = parseReseedArgs(process.argv.slice(2));
    // A small pool: the import is deliberately sequential (each food runs one transaction that takes the
    // per-name advisory lock and touches the shared nutrient dictionary), so extra connections buy only
    // contention. `max: 2` leaves one spare for the pool's own bookkeeping.
    const pool = new Pool({ ...foodPoolConfigFromEnv(), max: 2 });
    const db = drizzle(pool, { schema });

    try {
        // Name the SERVER before anything is written. `--stage` is the operator's DECLARATION and nothing
        // binds it to the database this process actually opened — the per-stage logical database is
        // `kitchensink_food` on BOTH prod and sandbox — so this line is what makes `--dry-run` a check
        // rather than a formality.
        logger.info('catalog-reseed-starting', {
            stage: options.stage,
            dryRun: options.dryRun,
            dirs: options.dirs,
            dataTypes: enabledDataTypes(options.datasets),
            target: await describeDatabaseTarget(pool),
        });

        const result = await runCatalogReseed(
            {
                source: createBulkSourceReader({ dataTypes: enabledDataTypes(options.datasets), logger }),
                seeder: new BulkSeedService({
                    foods: new FoodDao(db),
                    sources: new FoodSourcesDao(db),
                    persist: new MergeAndPersistService(db, new GoldenRecordMergeEngine(new SourceAdapterRegistry())),
                    logger,
                }),
                inventory: createCatalogInventory(db),
            },
            options,
        );

        logger.info('catalog-reseed-finished', { ...result });
    } finally {
        await pool.end();
    }
}

void bootstrap().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            level: 'error',
            component: 'food-catalog-reseed',
            message: 'catalog-reseed-failed',
            error: error instanceof Error ? error.message : String(error),
        }),
    );
    process.exitCode = 1;
});
