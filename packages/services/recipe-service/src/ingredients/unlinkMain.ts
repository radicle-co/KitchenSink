/**
 * Entrypoint for the recipe-side ingredient UNLINK (U12a, half one). Wires a short-lived `pg` pool and the
 * Drizzle adapter to {@link runIngredientUnlink}, prints one JSON line, and exits.
 *
 * Split from `unlinkCli.ts` for the same reason `main.ts` is split from `seedCli.ts` in the food service's
 * bulk seed: the decision logic must be importable by a test WITHOUT importing a module whose side effect
 * is "connect to a database and start nulling columns".
 *
 * ⛔ RUN THIS BEFORE the food-side clear (`npm run catalog:clear --workspace=packages/services/food-service`),
 * never after — see the header of `unlinkCli.ts`. The clear enforces the order itself and will refuse, but
 * the ordering is the operator's to get right.
 *
 * Usage:
 *
 *   STAGE=sandbox DATABASE_URL=postgres://… \
 *     npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --dry-run
 *   STAGE=sandbox DATABASE_URL=postgres://… \
 *     npm run ingredients:unlink --workspace=@kitchensink/recipe-service -- --confirm sandbox
 *
 * Exit code is non-zero on any refusal, incomplete run, or connection failure, so a scripted invocation
 * cannot mistake "the guard said no" for "there was nothing to do".
 *
 * @sideEffect Opens Postgres connections and writes to the recipe database.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from '../database/schema/index.js';
import { recipePoolConfigFromEnv } from '../database/poolConfig.js';
import { createIngredientLinkStore, parseUnlinkArgs, runIngredientUnlink } from './unlinkCli.js';

const { Pool } = pg;

/** The component tag on every log line this task emits. */
const COMPONENT = 'recipe-ingredient-unlink';

/**
 * Emit one structured JSON line, matching the food service's `ConsoleWorkerLogger` record shape so both
 * halves of the reset read the same way in CloudWatch.
 *
 * @param level - The log level.
 * @param message - The event name.
 * @param context - Structured fields.
 * @sideEffect Writes to `console`.
 */
function emit(level: 'info' | 'error', message: string, context: Record<string, unknown>): void {
    const record = JSON.stringify({
        level,
        component: COMPONENT,
        message,
        timestamp: new Date().toISOString(),
        ...context,
    });

    if (level === 'error') {
        console.error(record);
    } else {
        console.info(record);
    }
}

/**
 * Bootstrap, run one unlink, and exit.
 *
 * @sideEffect Connects to Postgres, updates `ingredients`, then closes the pool.
 */
async function bootstrap(): Promise<void> {
    const options = parseUnlinkArgs(process.argv.slice(2));
    // One connection is enough: the whole task is a handful of counts plus one transaction.
    const pool = new Pool({ ...recipePoolConfigFromEnv(), max: 1 });

    try {
        // ⛔ THE TARGET IS NO LONGER PRINTED HERE, and that is the fix (PR #91 review). This used to read the
        // server and log it under a comment admitting nothing bound `--stage` to it — a courtesy an operator
        // could read past. `runIngredientUnlink` now reads the same descriptor and REFUSES on it, reporting
        // it in the result and in the refusal message, so the target an operator sees is by construction the
        // one the guard judged. `result.target` is what a writing run must pass back as `--confirm-target`.
        emit('info', 'ingredient-unlink-starting', { stage: options.stage, dryRun: options.dryRun });

        emit('info', 'ingredient-unlink-finished', {
            ...(await runIngredientUnlink(createIngredientLinkStore(drizzle(pool, { schema })), options)),
        });
    } finally {
        await pool.end();
    }
}

void bootstrap().catch((error: unknown) => {
    emit('error', 'ingredient-unlink-failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
});
