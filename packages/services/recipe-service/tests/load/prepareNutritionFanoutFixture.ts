/**
 * Fixture prep for `nutritionBatch.load.js` — the two ingredient-overlap shapes ADR-0021's "Residual risk"
 * asks for, seeded straight into Postgres.
 *
 * k6 runs inside its own JS runtime and can import nothing but k6 built-ins (no `pg`), so seeding happens
 * OUT HERE, the same way `prepare-db.mjs` applies migrations and `prepareVersionArchiveFixture.ts` plants
 * the S3-only version. It cannot be done through the API either: 1,000 creates would take minutes, and the
 * decisive column — `ingredients.food_id` — is written only by the food-resolution path, which needs a
 * reachable food service and would give every ingredient a DIFFERENT food id on every run.
 *
 * ## What it seeds, and why the numbers are read back out
 *
 * Two sets of {@link FANOUT_RECIPE_COUNT} recipes with identical line counts, differing only in ingredient
 * overlap (see `nutritionFanoutFixture.ts` for the table). The emitted `distinctFoodCount` is **measured**
 * with SQL that walks `recipes → recipe_ingredients → ingredients.food_id` — the same path the service
 * walks — rather than derived from the loop that wrote the rows. A generator can be self-consistently
 * wrong; the database cannot lie about how many distinct foods a request will name, and that number is the
 * one the whole scenario turns on.
 *
 * Idempotent: fixed ids, `ON CONFLICT DO NOTHING` for the two id-keyed tables, and a delete-then-insert for
 * `recipe_ingredients`, which has no unique key a re-run could conflict with (so a plain insert would
 * silently double every recipe's line count — and double the measured fan-out).
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
    overlapRecipeId,
    requireDisposableDatabaseUrl,
    stapleFoodId,
    stapleIngredientId,
    wavesFor,
    type NutritionFanoutFixture,
    type NutritionFixtureSet,
} from './nutritionFanoutFixture.js';

/** Ingredients the zero-overlap set needs: one per line, shared by nothing. */
const FANOUT_INGREDIENT_COUNT = FANOUT_RECIPE_COUNT * FANOUT_LINES_PER_RECIPE;

/**
 * SQL renderings of the id functions.
 *
 * The whole fixture is inserted by `generate_series` rather than 16,000 parameterized statements, so each
 * id has to exist twice — once in TypeScript, once here. {@link assertIdRenderingsAgree} proves the two
 * agree against the rows actually written, which is the only check that survives an edit to either side.
 */
const SQL_ID = {
    fanoutRecipe: `('00000000-0000-4000-8000-a' || lpad(i::text, 11, '0'))::uuid`,
    overlapRecipe: `('00000000-0000-4000-8000-b' || lpad(i::text, 11, '0'))::uuid`,
    fanoutIngredient: `('00000000-0000-4000-8000-c' || lpad(i::text, 11, '0'))::uuid`,
    stapleIngredient: `('00000000-0000-4000-8000-d' || lpad(i::text, 11, '0'))::uuid`,
    fanoutFood: `('01JFAN0000F' || lpad(i::text, 15, '0'))`,
    stapleFood: `('01JFAN0000S' || lpad(i::text, 15, '0'))`,
} as const;

/** Every fixture recipe id, both sets, for the delete/cleanup paths. */
function allRecipeIds(): string[] {
    return [
        ...Array.from({ length: FANOUT_RECIPE_COUNT }, (_, index) => fanoutRecipeId(index)),
        ...Array.from({ length: FANOUT_RECIPE_COUNT }, (_, index) => overlapRecipeId(index)),
    ];
}

/**
 * Insert the catalog ingredients both sets draw on, each carrying its own opaque `food_id`.
 *
 * `RESOLVED` is not decoration: the deferred read only asks food about ingredients that name a food, and a
 * `PENDING` row would make every recipe answer `unaccounted{no_resolved_ingredients}` — a 200 with no
 * fan-out at all, which is the failure this fixture exists to prevent.
 *
 * @sideEffect Inserts into `ingredients`.
 */
async function seedIngredients(pool: pg.Pool): Promise<void> {
    await pool.query(
        `INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered, search_vector)
         SELECT ${SQL_ID.fanoutIngredient}, 'Fanout Ingredient ' || i, ${SQL_ID.fanoutFood},
                'RESOLVED', false, to_tsvector('english', 'fanout ingredient ' || i)
           FROM generate_series(0, $1 - 1) AS i
         ON CONFLICT DO NOTHING`,
        [FANOUT_INGREDIENT_COUNT],
    );

    await pool.query(
        `INSERT INTO ingredients (id, name, food_id, food_resolution_status, is_user_entered, search_vector)
         SELECT ${SQL_ID.stapleIngredient}, 'Pantry Staple ' || i, ${SQL_ID.stapleFood},
                'RESOLVED', false, to_tsvector('english', 'pantry staple ' || i)
           FROM generate_series(0, $1 - 1) AS i
         ON CONFLICT DO NOTHING`,
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
async function seedRecipes(pool: pg.Pool): Promise<void> {
    for (const [id, label] of [
        [SQL_ID.fanoutRecipe, 'Fanout'],
        [SQL_ID.overlapRecipe, 'Pantry'],
    ] as const) {
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, current_version)
             SELECT ${id}, $2, '${label} Load Recipe ' || i,
                    'Seeded by prepareNutritionFanoutFixture.ts for the k6 nutrition-batch scenario.',
                    5, 10, 15, $3, 'public', 1
               FROM generate_series(0, $1 - 1) AS i
             ON CONFLICT DO NOTHING`,
            [FANOUT_RECIPE_COUNT, FIXTURE_OWNER_ID, FIXTURE_SERVINGS],
        );
    }
}

/**
 * Replace both sets' ingredient lines.
 *
 * DELETE-then-INSERT because `recipe_ingredients` has no unique key over `(recipe_id, ingredient_id)`:
 * `ON CONFLICT DO NOTHING` has no arbiter to name here, so a re-run would append a second copy of every
 * line — doubling the measured distinct-food count without changing a single id.
 *
 * @sideEffect Deletes and inserts `recipe_ingredients` rows for the fixture recipes only.
 */
async function seedLines(pool: pg.Pool): Promise<void> {
    await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = ANY($1::uuid[])', [allRecipeIds()]);

    // Zero overlap: recipe r's line l takes ingredient (r * linesPerRecipe + l), so no two recipes share
    // an ingredient and therefore no two share a food.
    await pool.query(
        `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, sort_order,
                                         ingredient_name, is_user_entered)
         SELECT ('00000000-0000-4000-8000-a' || lpad(r::text, 11, '0'))::uuid,
                ('00000000-0000-4000-8000-c' || lpad((r * $2 + l)::text, 11, '0'))::uuid,
                $3, $4, l, 'Fanout Ingredient ' || (r * $2 + l), false
           FROM generate_series(0, $1 - 1) AS r, generate_series(0, $2 - 1) AS l`,
        [FANOUT_RECIPE_COUNT, FANOUT_LINES_PER_RECIPE, FIXTURE_LINE_QUANTITY_G, FIXTURE_LINE_UNIT],
    );

    // A shared pantry: every recipe draws its lines from the same `OVERLAP_STAPLE_COUNT` ingredients,
    // rotated by the recipe index so the rows are not 500 identical recipes.
    await pool.query(
        `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, sort_order,
                                         ingredient_name, is_user_entered)
         SELECT ('00000000-0000-4000-8000-b' || lpad(r::text, 11, '0'))::uuid,
                ('00000000-0000-4000-8000-d' || lpad(((r + l) % $5)::text, 11, '0'))::uuid,
                $3, $4, l, 'Pantry Staple ' || ((r + l) % $5), false
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
 */
async function assertIdRenderingsAgree(pool: pg.Pool): Promise<void> {
    // BOTH halves, deliberately. The high-overlap set is the CONTROL that makes the disjoint set's number
    // interpretable — a fan-out cost is only a cost relative to the same request width without the fan-out —
    // so a drift that silently emptied it would leave the expensive number with nothing to be compared
    // against, which is the same class of quiet failure as the padded ids this fixture replaces.
    const expectations = [
        { set: 'fanout', recipe: fanoutRecipeId(0), ingredient: fanoutIngredientId(0), food: fanoutFoodId(0) },
        // `overlapIngredientIndex(0, 0)` is 0, so recipe 0's line 0 is staple 0.
        { set: 'overlap', recipe: overlapRecipeId(0), ingredient: stapleIngredientId(0), food: stapleFoodId(0) },
    ] as const;

    for (const expected of expectations) {
        const { rows } = await pool.query<{ ingredient: string; food: string }>(
            `SELECT i.id::text AS ingredient, i.food_id AS food
               FROM recipes r
               JOIN recipe_ingredients li ON li.recipe_id = r.id AND li.sort_order = 0
               JOIN ingredients i         ON i.id = li.ingredient_id
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

        if (row.ingredient !== expected.ingredient || row.food !== expected.food) {
            throw new Error(
                `prepareNutritionFanoutFixture: seeded ${expected.set} ingredient/food (${row.ingredient} / ` +
                    `${row.food}) does not match the id functions (${expected.ingredient} / ${expected.food}).`,
            );
        }
    }
}

/**
 * MEASURE a set: how many distinct foods its recipe ids actually name, along the join the service walks.
 *
 * @sideEffect Reads `recipes`, `recipe_ingredients` and `ingredients`.
 */
async function measureSet(pool: pg.Pool, recipeIds: readonly string[]): Promise<NutritionFixtureSet> {
    const { rows } = await pool.query<{ foods: number }>(
        `SELECT count(DISTINCT i.food_id)::int AS foods
           FROM recipes r
           JOIN recipe_ingredients li ON li.recipe_id = r.id
           JOIN ingredients i         ON i.id = li.ingredient_id
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
 * @sideEffect Writes ~16,000 rows.
 */
export async function seedNutritionFanoutFixture(pool: pg.Pool): Promise<NutritionFanoutFixture> {
    await seedIngredients(pool);
    await seedRecipes(pool);
    await seedLines(pool);
    await assertIdRenderingsAgree(pool);

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
 * Remove every row this fixture owns, by its own id scheme.
 *
 * Used by the integration test so a spec that seeds 1,000 recipes does not leave them for a neighbouring
 * spec to count. The load path does NOT call it — a k6 run wants the fixture to persist.
 *
 * @sideEffect Deletes from `recipe_ingredients`, `recipes` and `ingredients`.
 */
export async function deleteNutritionFanoutFixture(pool: pg.Pool): Promise<void> {
    const recipeIds = allRecipeIds();

    await pool.query('DELETE FROM recipe_ingredients WHERE recipe_id = ANY($1::uuid[])', [recipeIds]);
    await pool.query('DELETE FROM recipes WHERE id = ANY($1::uuid[])', [recipeIds]);
    await pool.query(`DELETE FROM ingredients WHERE food_id LIKE '01JFAN0000%'`);
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

// `tsx tests/load/prepareNutritionFanoutFixture.ts` runs this; an importer (the integration test) does not.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
