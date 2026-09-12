/**
 * Fixture prep for `nutritionBatch.load.js` — the two ingredient-overlap shapes ADR-0021's "Residual risk"
 * asks for, seeded straight into Postgres.
 *
 * k6 runs inside its own JS runtime and can import nothing but k6 built-ins (no `pg`), so seeding happens
 * OUT HERE, the same way `prepareDb.mjs` applies migrations and `prepareVersionArchiveFixture.ts` plants
 * the S3-only version. It cannot be done through the API either: 1,000 creates would take minutes, and the
 * decisive column — `food_lookups.food_id` — is written only by the food-resolution path, which needs a
 * reachable food service and would give every line a DIFFERENT food id on every run.
 *
 * ## What it seeds, in the migration-0051 grain
 *
 * - one ROOT-arm binding (`food_lookups`, `food_id` set, no owner) per fixture food — the only arm the service
 *   asks food about (`RecipeDetailAssembler.loadLineCatalog`);
 * - two sets of {@link FANOUT_RECIPE_COUNT} public, published recipes;
 * - their recipe lines (`ingredients`), each pointing at one binding, in grams.
 *
 * The two sets have identical line counts and differ only in ingredient overlap (see
 * `nutritionFanoutFixture.ts` for the table).
 *
 * ## Why the numbers are read back out
 *
 * The emitted `distinctFoodCount` is **measured** with SQL that walks `recipes → ingredients →
 * food_lookups.food_id` — the same path the service walks — rather than derived from the loop that wrote the
 * rows. A generator can be self-consistently wrong; the database cannot lie about how many distinct foods a
 * request will name, and that number is the one the whole scenario turns on.
 *
 * Idempotent: fixed ids and `ON CONFLICT (id) DO NOTHING` for bindings and recipes, and a delete-then-insert
 * for the lines. The lines are replaced rather than conflict-checked because they carry no fixed id: a plain
 * re-insert would silently double every recipe's line count. All of it runs in ONE transaction, so a failed
 * run leaves nothing half-written — in particular, never 1,000 recipes with no lines, which would measure zero.
 *
 * Usage: `DATABASE_URL=postgres://…/recipe_load npx tsx tests/load/prepareNutritionFanoutFixture.ts`
 *
 * @sideEffect Connects to PostgreSQL, writes ~16,000 rows, and writes the fixture JSON beside this script.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
    FANOUT_LINES_PER_RECIPE,
    FANOUT_LOOKUP_COUNT,
    FANOUT_RECIPE_COUNT,
    FIXTURE_LINE_QUANTITY_G,
    FIXTURE_LINE_UNIT,
    FIXTURE_OWNER_ID,
    FIXTURE_SERVINGS,
    NUTRITION_FIXTURE_FILENAME,
    NUTRITION_PAGE_RECIPES,
    OVERLAP_STAPLE_COUNT,
    PLAN_RECIPES,
    chunksFor,
    fanoutFoodId,
    fanoutIngredientId,
    fanoutRecipeId,
    fixtureLookupIds,
    fixtureRecipeIds,
    overlapRecipeId,
    requireDisposableDatabaseUrl,
    stapleFoodId,
    stapleIngredientId,
    wavesFor,
    type NutritionFanoutFixture,
    type NutritionFixtureSet,
} from './nutritionFanoutFixture.js';

/**
 * SQL renderings of the id functions, each over a SQL integer expression (`i`, `r * $2 + l`, …).
 *
 * The whole fixture is inserted by `generate_series` rather than 16,000 parameterized statements, so each
 * id has to exist twice — once in TypeScript, once here. {@link assertIdRenderingsAgree} proves the two
 * agree against the rows actually written, which is the only check that survives an edit to either side.
 */
const SQL_ID = {
    fanoutRecipe: (index: string) => `('00000000-0000-4000-8000-a' || lpad((${index})::text, 11, '0'))::uuid`,
    overlapRecipe: (index: string) => `('00000000-0000-4000-8000-b' || lpad((${index})::text, 11, '0'))::uuid`,
    fanoutLookup: (index: string) => `('00000000-0000-4000-8000-c' || lpad((${index})::text, 11, '0'))::uuid`,
    stapleLookup: (index: string) => `('00000000-0000-4000-8000-d' || lpad((${index})::text, 11, '0'))::uuid`,
    fanoutFood: (index: string) => `('01JFAN0000F' || lpad((${index})::text, 15, '0'))`,
    stapleFood: (index: string) => `('01JFAN0000S' || lpad((${index})::text, 15, '0'))`,
} as const;

/**
 * Run `work` inside one transaction on one pooled client: all of it lands, or none of it does.
 *
 * @param pool - Where to take the client from.
 * @param work - The statements to run.
 * @returns Whatever `work` resolves to, after COMMIT.
 * @sideEffect Opens a transaction; commits on success and rolls back on failure.
 */
async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken: Error | undefined;

    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }

        throw error;
    } finally {
        // A client whose ROLLBACK failed is destroyed, not handed back to the pool mid-transaction.
        client.release(broken);
    }
}

/**
 * Insert the bindings both sets draw on: one ROOT-arm `food_lookups` row per fixture food.
 *
 * The root arm is not decoration. The service asks food only about bindings with a `food_id`; a binding on a
 * variant or a failure record names no food there, so every recipe would answer
 * `unaccounted{no_resolved_ingredients}` — a 200 with no fan-out at all, which is the failure this fixture
 * exists to prevent. No `food_owner_id` either: an owner records that the food is someone's private authored
 * food, and food answers a private food only for its author.
 *
 * `ON CONFLICT (id)` and not a bare `ON CONFLICT`: a row that holds a fixture food id under ANOTHER binding id
 * is not the fixture's row, and the unique index on `food_id` should then fail the seed loudly.
 *
 * @sideEffect Inserts into `food_lookups`.
 */
async function seedLookups(client: pg.PoolClient): Promise<void> {
    await client.query(
        `INSERT INTO food_lookups (id, food_id)
         SELECT ${SQL_ID.fanoutLookup('i')}, ${SQL_ID.fanoutFood('i')}
           FROM generate_series(0, $1 - 1) AS i
         ON CONFLICT (id) DO NOTHING`,
        [FANOUT_LOOKUP_COUNT],
    );

    await client.query(
        `INSERT INTO food_lookups (id, food_id)
         SELECT ${SQL_ID.stapleLookup('i')}, ${SQL_ID.stapleFood('i')}
           FROM generate_series(0, $1 - 1) AS i
         ON CONFLICT (id) DO NOTHING`,
        [OVERLAP_STAPLE_COUNT],
    );
}

/**
 * Insert both recipe sets.
 *
 * `public` + the default `published` status is load-bearing, not convenience: REQ-IF-008 OMITS a recipe the
 * caller may not read, so a `private` fixture would answer `{}` in a few milliseconds and report a
 * flattering p95 for a request that did no work.
 *
 * @sideEffect Inserts into `recipes`.
 */
async function seedRecipes(client: pg.PoolClient): Promise<void> {
    for (const [id, label] of [
        [SQL_ID.fanoutRecipe('i'), 'Fanout'],
        [SQL_ID.overlapRecipe('i'), 'Pantry'],
    ] as const) {
        await client.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, current_version)
             SELECT ${id}, $2, '${label} Load Recipe ' || i,
                    'Seeded by prepareNutritionFanoutFixture.ts for the k6 nutrition-batch scenario.',
                    5, 10, 15, $3, 'public', 1
               FROM generate_series(0, $1 - 1) AS i
             ON CONFLICT (id) DO NOTHING`,
            [FANOUT_RECIPE_COUNT, FIXTURE_OWNER_ID, FIXTURE_SERVINGS],
        );
    }
}

/**
 * Replace both sets' recipe lines (`ingredients`).
 *
 * DELETE-then-INSERT, scoped to the fixture's own recipes, because a line has no fixed id: a re-run would
 * otherwise append a second copy of every line.
 *
 * @sideEffect Deletes and inserts `ingredients` rows for the fixture recipes only.
 */
async function seedLines(client: pg.PoolClient): Promise<void> {
    await client.query('DELETE FROM ingredients WHERE recipe_id = ANY($1::uuid[])', [fixtureRecipeIds()]);

    // Zero overlap: recipe r's line l takes binding (r * linesPerRecipe + l), so no two recipes share a
    // binding and therefore no two share a food.
    await client.query(
        `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order)
         SELECT ${SQL_ID.fanoutRecipe('r')}, ${SQL_ID.fanoutLookup('r * $2 + l')}, $3, $4, l
           FROM generate_series(0, $1 - 1) AS r, generate_series(0, $2 - 1) AS l`,
        [FANOUT_RECIPE_COUNT, FANOUT_LINES_PER_RECIPE, FIXTURE_LINE_QUANTITY_G, FIXTURE_LINE_UNIT],
    );

    // A shared pantry: every recipe draws its lines from the same `OVERLAP_STAPLE_COUNT` bindings, rotated by
    // the recipe index (`overlapIngredientIndex`) so the rows are not 500 identical recipes.
    await client.query(
        `INSERT INTO ingredients (recipe_id, food_lookup_id, quantity, unit, sort_order)
         SELECT ${SQL_ID.overlapRecipe('r')}, ${SQL_ID.stapleLookup('(r + l) % $5')}, $3, $4, l
           FROM generate_series(0, $1 - 1) AS r, generate_series(0, $2 - 1) AS l`,
        [
            FANOUT_RECIPE_COUNT,
            FANOUT_LINES_PER_RECIPE,
            FIXTURE_LINE_QUANTITY_G,
            FIXTURE_LINE_UNIT,
            OVERLAP_STAPLE_COUNT,
        ],
    );
}

/**
 * Prove the SQL id renderings and the TypeScript id functions agree, on the rows actually written.
 *
 * Without this the two renderings are two sources of truth for the same id, and a drift between them is
 * invisible: the seed still succeeds, the k6 script still gets 500 well-formed uuids, and every one of
 * them resolves to no recipe — the padded-id failure this fixture replaces, reintroduced by a typo.
 *
 * @throws When a seeded row's id does not match the function that is supposed to mint it.
 * @sideEffect Reads `recipes`, `ingredients` and `food_lookups`.
 */
async function assertIdRenderingsAgree(client: pg.PoolClient): Promise<void> {
    // BOTH halves, deliberately. The high-overlap set is the CONTROL that makes the disjoint set's number
    // interpretable — a fan-out cost is only a cost relative to the same request width without the fan-out —
    // so a drift that silently emptied it would leave the expensive number with nothing to be compared
    // against, which is the same class of quiet failure as the padded ids this fixture replaces.
    const expectations = [
        { set: 'fanout', recipe: fanoutRecipeId(0), lookup: fanoutIngredientId(0), food: fanoutFoodId(0) },
        // `overlapIngredientIndex(0, 0)` is 0, so recipe 0's line 0 is staple 0.
        { set: 'overlap', recipe: overlapRecipeId(0), lookup: stapleIngredientId(0), food: stapleFoodId(0) },
    ] as const;

    for (const expected of expectations) {
        const { rows } = await client.query<{ lookup: string; food: string | null }>(
            `SELECT fl.id::text AS lookup, fl.food_id AS food
               FROM recipes r
               JOIN ingredients li  ON li.recipe_id = r.id AND li.sort_order = 0
               JOIN food_lookups fl ON fl.id = li.food_lookup_id
              WHERE r.id = $1::uuid`,
            [expected.recipe],
        );
        const row = rows[0];

        if (row === undefined) {
            throw new Error(
                `prepareNutritionFanoutFixture: ${expected.set} recipe ${expected.recipe} has no line 0 after ` +
                    'seeding — the SQL id rendering and the TypeScript id functions disagree, so the k6 script ' +
                    'would ask about ids that resolve to nothing (exactly the defect this fixture replaces).',
            );
        }

        if (row.lookup !== expected.lookup || row.food !== expected.food) {
            throw new Error(
                `prepareNutritionFanoutFixture: seeded ${expected.set} binding/food (${row.lookup} / ` +
                    `${row.food}) does not match the id functions (${expected.lookup} / ${expected.food}).`,
            );
        }
    }
}

/**
 * MEASURE a set: how many distinct foods its recipe ids actually name, along the join the service walks.
 *
 * @sideEffect Reads `recipes`, `ingredients` and `food_lookups`.
 */
async function measureSet(pool: pg.Pool, recipeIds: readonly string[]): Promise<NutritionFixtureSet> {
    const { rows } = await pool.query<{ foods: number }>(
        `SELECT count(DISTINCT fl.food_id)::int AS foods
           FROM recipes r
           JOIN ingredients li  ON li.recipe_id = r.id
           JOIN food_lookups fl ON fl.id = li.food_lookup_id
          WHERE r.id = ANY($1::uuid[])
            AND r.deleted_at IS NULL
            AND r.visibility = 'public'
            AND r.status = 'published'`,
        [[...recipeIds]],
    );
    const distinctFoodCount = rows[0]?.foods ?? 0;

    return {
        recipeIds,
        distinctFoodCount,
        expectedChunks: chunksFor(distinctFoodCount),
        expectedWaves: wavesFor(distinctFoodCount),
    };
}

/**
 * Seed both sets and report what the database says they cost.
 *
 * @param pool - A pool on a DISPOSABLE database (see `requireDisposableDatabaseUrl`).
 * @returns The fixture, with every food count measured rather than assumed.
 * @sideEffect Writes ~16,000 rows in one transaction, then reads them back.
 */
export async function seedNutritionFanoutFixture(pool: pg.Pool): Promise<NutritionFanoutFixture> {
    await inTransaction(pool, async (client) => {
        await seedLookups(client);
        await seedRecipes(client);
        await seedLines(client);
        await assertIdRenderingsAgree(client);
    });

    const fanoutIds = Array.from({ length: FANOUT_RECIPE_COUNT }, (_, index) => fanoutRecipeId(index));
    const overlapIds = Array.from({ length: FANOUT_RECIPE_COUNT }, (_, index) => overlapRecipeId(index));

    const [fanout, overlap, page, plan] = await Promise.all([
        measureSet(pool, fanoutIds),
        measureSet(pool, overlapIds),
        measureSet(pool, overlapIds.slice(0, NUTRITION_PAGE_RECIPES)),
        measureSet(pool, fanoutIds.slice(0, PLAN_RECIPES)),
    ]);

    return { fanout, overlap, page, plan };
}

/**
 * Remove every row this fixture owns, by its own id lists — never by a pattern.
 *
 * Used by the e2e test so a spec that seeds 1,000 recipes does not leave them for a neighbouring spec to
 * count. The load path does NOT call it — a k6 run wants the fixture to persist.
 *
 * The order is set by the foreign keys: the lines go with their recipes (`ingredients.recipe_id` is
 * `ON DELETE CASCADE`), and only then can the bindings go (`ingredients.food_lookup_id` is `RESTRICT`).
 *
 * @sideEffect Deletes from `recipes` (and, by cascade, `ingredients`) and `food_lookups`, in one transaction.
 */
export async function deleteNutritionFanoutFixture(pool: pg.Pool): Promise<void> {
    await inTransaction(pool, async (client) => {
        await client.query('DELETE FROM recipes WHERE id = ANY($1::uuid[])', [fixtureRecipeIds()]);
        await client.query('DELETE FROM food_lookups WHERE id = ANY($1::uuid[])', [fixtureLookupIds()]);
    });
}

/**
 * CLI entry point: guard the target database, seed, and emit the JSON the k6 script opens.
 *
 * @sideEffect Database I/O, a file write, and `process.exit` on a rejected target.
 */
async function main(): Promise<void> {
    const pool = new pg.Pool({ connectionString: requireDisposableDatabaseUrl() });

    try {
        const fixture = await seedNutritionFanoutFixture(pool);
        const outDir = dirname(fileURLToPath(import.meta.url));

        // Emitted in the repo's own prettier shape (4-space indent, trailing newline) so `format:check`
        // passes on a tree where the fixture has been generated. Food's equivalent is exempted by a line in
        // its package `.prettierignore` instead; recipe-service's has no such line, and adding one is not
        // this file's to do — matching the formatter costs nothing and leaves the blob readable.
        writeFileSync(join(outDir, NUTRITION_FIXTURE_FILENAME), `${JSON.stringify(fixture, null, 4)}\n`, 'utf-8');

        console.log(
            `prepareNutritionFanoutFixture: fanout ${fixture.fanout.recipeIds.length} recipes → ` +
                `${fixture.fanout.distinctFoodCount} distinct foods → ${fixture.fanout.expectedChunks} chunks → ` +
                `${fixture.fanout.expectedWaves} waves; overlap ${fixture.overlap.recipeIds.length} recipes → ` +
                `${fixture.overlap.distinctFoodCount} distinct foods → ${fixture.overlap.expectedWaves} wave(s).`,
        );
    } finally {
        await pool.end();
    }
}

// `tsx tests/load/prepareNutritionFanoutFixture.ts` runs this; an importer (the e2e test) does not.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
