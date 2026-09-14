/**
 * Entrypoint for the food-catalog CLEAR (U12a, half two). Wires two short-lived `pg` pools — this
 * service's own food database, and the READ-ONLY probe onto the recipe database that makes the ordering
 * enforceable — hands both adapters to {@link runCatalogClear}, prints one JSON line, and exits.
 *
 * Split from `clearCli.ts` for the same reason `main.ts` is split from `seedCli.ts`: the decision logic
 * must be importable by a test WITHOUT importing a module whose side effect is "connect to a database and
 * start deleting the catalog".
 *
 * ⛔ THE RECIPE-SIDE UNLINK RUNS FIRST. This task refuses to delete anything while the recipe database
 * still reports linked ingredient rows — see the header of `clearCli.ts` for why the reverse order is
 * unrecoverable and invisible.
 *
 * Usage:
 *
 *   STAGE=sandbox DATABASE_URL=postgres://…/kitchensink_food \
 *   RECIPE_DATABASE_URL=postgres://…/kitchensink_recipes \
 *     npm run catalog:clear --workspace=packages/services/food-service -- --dry-run
 *   … same, then -- --confirm sandbox
 *
 * Exit code is non-zero on any refusal, blocked run, incomplete clear, or connection failure, so a
 * scripted invocation cannot mistake "the guard said no" for "there was nothing to do".
 *
 * @sideEffect Opens Postgres connections and deletes from the food database.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { foodPoolConfigFromEnv } from '../../database/poolConfig.js';
import * as schema from '../../db/schema/index.js';
import { ConsoleWorkerLogger } from '../../worker/ConsoleWorkerLogger.js';
import { createFoodCatalogStore, createRecipeLinkageProbe, parseClearArgs, runCatalogClear } from './clearCli.js';

const { Pool } = pg;

/**
 * Bootstrap, run one clear, and exit.
 *
 * @sideEffect Connects to two Postgres databases, deletes the food catalog, then closes both pools.
 */
async function bootstrap(): Promise<void> {
    const logger = new ConsoleWorkerLogger('food-catalog-clear');
    const options = parseClearArgs(process.argv.slice(2));
    // One connection each: the task is a handful of counts plus one transaction per database.
    const foodPool = new Pool({ ...foodPoolConfigFromEnv(), max: 1 });
    const recipePool = new Pool({ connectionString: options.recipeDatabaseUrl, max: 1 });

    try {
        logger.info('catalog-clear-starting', { stage: options.stage, dryRun: options.dryRun });

        // ⛔ THE TARGETS ARE NO LONGER PRINTED HERE, and that is the fix rather than a loss (PR #91 review).
        // This used to read both servers and log them, with a comment admitting nothing bound `--stage` to
        // them — a courtesy an operator could read past. The COMMAND now reads the same descriptors and
        // REFUSES on them, and reports them in its result (and in its refusal message), so the target an
        // operator sees is by construction the one the guard judged rather than a second, parallel read.
        const result = await runCatalogClear(
            {
                linkage: createRecipeLinkageProbe(recipePool),
                catalog: createFoodCatalogStore(drizzle(foodPool, { schema }), foodPool),
            },
            options,
        );

        // `result.target` is the string a destructive run must pass back as `--confirm-target`.
        logger.info('catalog-clear-finished', { ...result });
    } finally {
        await Promise.all([foodPool.end(), recipePool.end()]);
    }
}

void bootstrap().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            level: 'error',
            component: 'food-catalog-clear',
            message: 'catalog-clear-failed',
            error: error instanceof Error ? error.message : String(error),
        }),
    );
    process.exitCode = 1;
});
