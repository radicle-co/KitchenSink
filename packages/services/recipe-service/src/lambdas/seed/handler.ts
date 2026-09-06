/**
 * Seed the deterministic recipe world into a per-PR preview's database, during that preview's deploy.
 *
 * DESIGN PATTERN: Adapter over `@kitchensink/recipe-core`'s seeding policy and `database/seed.ts`. It owns
 * the pool's lifecycle and the two refusals; it owns NO seeding behaviour, which stays in `seed.ts` as the
 * one authoritative definition of the seeded world. An adapter that grew fixture logic would be a service
 * in disguise.
 *
 * ## Why the seed runs inside the deploy at all
 *
 * The fixture world is what the deployed Maestro and Playwright tiers assert against — its recipes ARE
 * `E2E_RECIPE_LAMB`, `E2E_RECIPE_ASPARAGUS` and `E2E_RECIPE_RISOTTO`. `seed.ts` describes itself as safe to
 * run on every deploy, and nothing ran it: only `tests/globalSetup.ts` did, so a locally-booted stack had
 * the world and a deployed preview never did.
 *
 * ## ⛔ Two doors, and prod is excluded by BOTH independently
 *
 * The seed writes recipes owned by two FABRICATED subjects, some public. Against production that is fake
 * public recipes, owned by users who do not exist, in the real discovery feed.
 *
 * The primary interlock is upstream: `RecipeServiceStack` constructs this function only when
 * {@link seedsRecipeWorldOnDeploy} holds, so prod's template declares no seed function, no trigger and no
 * database grant. But a runtime that trusts its own absence is not an interlock, so this re-asks — on the
 * STAGE STRING, and again on the DATABASE IDENTITY. The two are deliberately different in kind: a stage
 * variable copied between environments is caught by the second, a colliding database name by the first.
 * Neither may depend on the other being correct, which is the shape `isScheduledCluster` uses for the same
 * reason.
 *
 * Both are checked BEFORE the pool is built. A refusal that has already connected to production has
 * already done the thing it exists to make impossible.
 *
 * A refusal THROWS. The `triggers.Trigger` framework surfaces a `FunctionError` as a failed stack event,
 * so reaching this function where it may not seed reds the deploy — which is correct, because that state
 * is a defect in the stack, not a condition to tolerate.
 *
 * ⚠️ `database/seed.ts` self-runs when invoked directly, guarded on `process.argv[1] === import.meta.url`.
 * Inside the Lambda runtime `process.argv[1]` is the bootstrap, so that branch is dead here — worth
 * stating once, because it is the kind of thing a reader worries about and then never revisits.
 *
 * @sideEffect Connects to the recipe database and writes the fixture world.
 */
import pg from 'pg';

import { BASE_RECIPE_DATABASE_NAME } from '@kitchensink/recipe-core/database-name';
import { seedsRecipeWorldOnDeploy } from '@kitchensink/recipe-core/seed-on-deploy';

import { RECIPE_DB_USERNAME, recipePoolConfig } from '../../database/poolConfig.js';
import { seed } from '../../database/seed.js';
import type { SeedCounts } from '../../database/seed.js';

const { Pool } = pg;

/**
 * Read a required environment variable.
 *
 * @param name - The variable's name.
 * @returns Its value.
 * @throws {Error} when it is unset or blank.
 */
function requireEnv(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
        throw new Error(`Refusing to seed: ${name} is not set.`);
    }

    return value;
}

/**
 * Seed this stage's recipe world.
 *
 * @returns What the seed inserted.
 * @throws {Error} when this stage or this database may not be seeded.
 * @sideEffect Network and database I/O.
 */
export const handler = async (): Promise<SeedCounts> => {
    const stage = process.env['STAGE'];

    // ⛔ DOOR 1 — the stage. An allowlist, so an unset or unanticipated value fails closed.
    if (!seedsRecipeWorldOnDeploy(stage)) {
        throw new Error(
            `Refusing to seed: stage '${stage ?? '(unset)'}' may not seed the recipe world. Only a per-PR ` +
                'preview may, because the fixture world is owned by fabricated subjects and some of it is public.',
        );
    }

    const databaseName = requireEnv('DB_NAME');

    // ⛔ DOOR 2 — the database. A different fact from door 1, checked independently.
    if (databaseName === BASE_RECIPE_DATABASE_NAME) {
        throw new Error(
            `Refusing to seed: '${databaseName}' is the SHARED base database, not a per-PR one. A stage ` +
                'variable copied between environments passes the stage check and must still not reach it.',
        );
    }

    const port = Number(requireEnv('DB_PORT'));

    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Refusing to seed: invalid DB_PORT "${process.env['DB_PORT']}" — expected a TCP port.`);
    }

    const pool = new Pool({
        ...recipePoolConfig({
            host: requireEnv('DB_HOST'),
            port,
            database: databaseName,
            username: RECIPE_DB_USERNAME,
        }),
        max: 1,
    });

    try {
        return await seed(pool);
    } finally {
        await pool.end();
    }
};
