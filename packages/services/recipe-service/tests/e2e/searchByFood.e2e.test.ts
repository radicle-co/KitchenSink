/**
 * Recipe search's food filter against a real migrated PostgreSQL (plan 002 R9; LOCAL e2e under the 2026-09-20
 * ruling).
 *
 * The filter follows each line to its binding: a recipe matches a ROOT food id when one of its lines is bound to
 * that food. Three rules a mock cannot prove, because each lives in the SQL:
 *
 * - a declared or unresolved line matches no food id, whatever its failure record names;
 * - a private food matches only for its author, so a stranger cannot confirm another cook's private food by
 *   filtering on its id;
 * - the filter narrows, it never widens: a stranger still sees only public, published recipes.
 *
 * Every row this file writes carries {@link SCOPE} and is removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { createRecipeDrizzle } from '../../src/database/client.js';
import { SearchDal } from '../../src/search/dal/search.dal.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-search-food';
const AUTHOR = '01JSEARCHFOOD0000000AUTHOR';
const STRANGER = '01JSEARCHFOOD000000STRANGR';
const SHARED_FOOD = `${SCOPE}-shared`;
const PRIVATE_FOOD = `${SCOPE}-private`;
const VARIANT_FOOD = `${SCOPE}-variant`;

let pool: pg.Pool;
let dal: SearchDal;
let sharedRecipe: string;
let privateRecipe: string;
let declaredRecipe: string;
let variantRecipe: string;

/** Insert one row and return its id. */
async function insertReturningId(text: string, values: readonly unknown[]): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(text, [...values]);
    const row = rows[0];

    if (row === undefined) {
        throw new Error(`fixture insert returned no row: ${text}`);
    }

    return row.id;
}

/** A public, published recipe owned by the author, with one line bound to `lookupId`. */
async function recipeBoundTo(label: string, lookupId: string): Promise<string> {
    const recipeId = await insertReturningId(
        `INSERT INTO recipes (owner_id, title, prep_time_minutes, cook_time_minutes, total_time_minutes, servings)
              VALUES ($1, $2, 5, 10, 15, 2) RETURNING id`,
        [AUTHOR, `${SCOPE} ${label}`],
    );

    await pool.query(`INSERT INTO ingredients (recipe_id, food_lookup_id, unit) VALUES ($1, $2, 'g')`, [
        recipeId,
        lookupId,
    ]);

    return recipeId;
}

/**
 * Search as `viewer` for recipes bound to any of `rootIds` or `variantIds`, and return the matched recipe ids.
 *
 * The variant arm is what the service's expansion hands the DAL for a filtered root's live variants (curated U9).
 */
async function matches(
    viewer: string,
    rootIds: readonly string[],
    variantIds: readonly string[] = [],
): Promise<string[]> {
    const { results } = await dal.search({
        ownerId: viewer,
        foodFilter: { rootIds, variantIds },
        page: 1,
        pageSize: 50,
        sortBy: 'recent',
    });

    return results
        .map((result) => result.recipe.id)
        .filter((id) => [sharedRecipe, privateRecipe, declaredRecipe, variantRecipe].includes(id));
}

describe('SearchDal — the food filter (real Postgres)', () => {
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
        dal = new SearchDal(createRecipeDrizzle(pool));

        const sharedLookup = await insertReturningId(`INSERT INTO food_lookups (food_id) VALUES ($1) RETURNING id`, [
            SHARED_FOOD,
        ]);
        const privateLookup = await insertReturningId(
            `INSERT INTO food_lookups (food_id, food_owner_id) VALUES ($1, $2) RETURNING id`,
            [PRIVATE_FOOD, AUTHOR],
        );
        // A declared line whose failure record happens to share the shared food's id as its NAME: a filter that
        // matched on anything but the bound food id would pick it up.
        const failure = await insertReturningId(
            `INSERT INTO unresolved_foods (name, normalized_key, reason_code, food_handle_id)
                  VALUES ($1, $1, 'author_declared', NULL) RETURNING id`,
            [SHARED_FOOD],
        );
        const declaredLookup = await insertReturningId(
            `INSERT INTO food_lookups (unresolved_food_id) VALUES ($1) RETURNING id`,
            [failure],
        );

        const variantLookup = await insertReturningId(
            `INSERT INTO food_lookups (food_variant_id) VALUES ($1) RETURNING id`,
            [VARIANT_FOOD],
        );

        variantRecipe = await recipeBoundTo('variant', variantLookup);
        sharedRecipe = await recipeBoundTo('shared', sharedLookup);
        privateRecipe = await recipeBoundTo('private', privateLookup);
        declaredRecipe = await recipeBoundTo('declared', declaredLookup);
    });

    afterAll(async () => {
        if (pool === undefined) {
            return;
        }

        await pool.query(`DELETE FROM recipes WHERE title LIKE $1`, [`${SCOPE}%`]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    });

    it('matches a recipe with a line bound to the food, and not a declared line that merely names it', async () => {
        expect(await matches(STRANGER, [SHARED_FOOD])).toStrictEqual([sharedRecipe]);
    });

    it('⛔ matches a PRIVATE food for its author only — a stranger filtering on its id learns nothing', async () => {
        expect(await matches(AUTHOR, [PRIVATE_FOOD])).toStrictEqual([privateRecipe]);
        expect(await matches(STRANGER, [PRIVATE_FOOD])).toStrictEqual([]);
    });

    it('ORs the ids it is given, and matches nothing for a food no line is bound to', async () => {
        expect((await matches(AUTHOR, [SHARED_FOOD, PRIVATE_FOOD])).sort()).toStrictEqual(
            [sharedRecipe, privateRecipe].sort(),
        );
        expect(await matches(AUTHOR, [`${SCOPE}-nobody`])).toStrictEqual([]);
    });

    it('⛔ matches a recipe whose only line is bound to one of the root’s VARIANTS (curated U9)', async () => {
        expect(await matches(STRANGER, [SHARED_FOOD], [VARIANT_FOOD])).toStrictEqual(
            expect.arrayContaining([sharedRecipe, variantRecipe]),
        );
        expect(await matches(STRANGER, [`${SCOPE}-other-root`], [VARIANT_FOOD])).toStrictEqual([variantRecipe]);
    });

    it('a root with NO variants in the filter still matches only its own lines — the variant arm adds, never widens', async () => {
        expect(await matches(STRANGER, [SHARED_FOOD])).toStrictEqual([sharedRecipe]);
    });
});
