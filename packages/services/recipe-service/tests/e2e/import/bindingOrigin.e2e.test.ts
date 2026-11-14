/**
 * `bound_by` and `import_line_id` survive the editor's saves, against a REAL database (LOCAL e2e, ADR-0072 §5), through the
 * fully assembled app and a food-service fake.
 *
 * What a mocked DAL cannot prove, and each case is there to catch:
 *
 *  - the two columns are really WRITTEN by `replaceForRecipe` (the unit tier sees an object handed to a fake) and the
 *    `ingredients_bound_by_check` CHECK admits every value the rule produces;
 *  - ⛔ a TITLE-ONLY `PATCH` that resends every line (both shipped editors do) keeps a bound line's origin AND a line kept
 *    as written (which has a `food_lookup_id` too, an unresolved one) with its link: the case a rule fed raw lookup ids fails;
 *  - ⛔ a different food on a line makes it `cook` and drops the link;
 *  - an ordinary create stamps `cook` on a food and leaves a line kept as written with no origin;
 *  - the link is only provenance: deleting the import clears it (`ON DELETE SET NULL`) and the line and the recipe stay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-bound-by';
const AUTHOR = '01JBOUNDBYE2E00000AUTHOR00';
const FLOUR = `${SCOPE}-flour`;
const BUTTER = `${SCOPE}-butter`;

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly ingredients: readonly { readonly ingredientId: string }[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let flour: string;
let butter: string;
let spiceMix: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${booted.baseUrl}${path}`, {
        method,
        headers: { authorization: bearerFor(AUTHOR), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

const flourLine = () => ({
    ingredientId: flour,
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    sourceLine: '2 cups flour',
    sourcePhrase: 'flour',
});
const spiceLine = () => ({
    ingredientId: spiceMix,
    quantity: { kind: 'absent' },
    sourceLine: 'a pinch of grandma’s mix',
});

/** The same lines as an UPDATE carries them: a PATCH cannot state a transcription (it is carried forward from storage). */
const patchLine = (line: ReturnType<typeof flourLine> | ReturnType<typeof spiceLine>) => {
    const { sourceLine: _sourceLine, ...rest } = line;
    const { sourcePhrase: _sourcePhrase, ...bare } = rest as typeof rest & { sourcePhrase?: string };

    return bare;
};

async function draft(): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} pancakes`,
        status: 'draft',
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [flourLine(), spiceLine()],
        steps: [{ instruction: 'Mix.' }],
    });
}

/** `[bound_by, import_line_id]` of each line, in order. */
async function origins(recipeId: string): Promise<(string | null)[][]> {
    const { rows } = await pool.query<{ bound_by: string | null; import_line_id: string | null }>(
        `SELECT bound_by, import_line_id::text AS import_line_id FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
        [recipeId],
    );

    return rows.map((row) => [row.bound_by, row.import_line_id]);
}

/** A snapshot line the import would have made, so the link has something real to point at. */
async function snapshotLines(count: number): Promise<{ importId: string; lineIds: string[] }> {
    const imp = await pool.query<{ id: string }>(
        `INSERT INTO recipe_imports (user_id, match_mode, visibility, expected_total) VALUES ($1, 'bindBest', 'private', $2) RETURNING id`,
        [AUTHOR, count],
    );
    const importId = imp.rows[0]?.id ?? '';
    const lineIds: string[] = [];

    for (let ordinal = 0; ordinal < count; ordinal += 1) {
        await pool.query(
            `INSERT INTO recipe_import_items (import_id, ordinal, title, payload, stage) VALUES ($1, $2, 'x', '{}'::jsonb, 'received')`,
            [importId, ordinal],
        );
        const line = await pool.query<{ id: string }>(
            `INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, name, unit)
             VALUES ($1, $2, 0, 0, 'l', 'ld', 'jd', 'p', 'p', '') RETURNING id`,
            [importId, ordinal],
        );

        lineIds.push(line.rows[0]?.id ?? '');
    }

    return { importId, lineIds };
}

describe('bound_by and import_line_id through the editor’s saves (LOCAL e2e, real Postgres)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(FLOUR, { name: 'Wheat flour', status: 'RESOLVED' });
        food.foods.set(BUTTER, { name: 'Butter', status: 'RESOLVED' });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        flour = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: FLOUR })).id;
        butter = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BUTTER })).id;
        spiceMix = (await json<{ id: string }>('POST', '/api/v1/ingredients', 201, { name: `${SCOPE} grandma’s mix` }))
            .id;
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [AUTHOR]);
            await pool.query(`DELETE FROM recipe_imports WHERE user_id = $1`, [AUTHOR]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('an ordinary create stamps `cook` on a food the caller chose and leaves a line kept as written with no origin', async () => {
        const recipe = await draft();

        expect(await origins(recipe.id)).toStrictEqual([
            ['cook', null],
            [null, null],
        ]);
    });

    it('⛔ a title-only PATCH that resends every line keeps the bound origin AND the as-written line’s link', async () => {
        const recipe = await draft();
        const { lineIds } = await snapshotLines(2);

        await pool.query(
            `UPDATE ingredients SET bound_by = 'autoBest', import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 0`,
            [recipe.id, lineIds[0]],
        );
        await pool.query(`UPDATE ingredients SET import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 1`, [
            recipe.id,
            lineIds[1],
        ]);

        await json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            title: `${SCOPE} a new title`,
            ingredients: [patchLine(flourLine()), patchLine(spiceLine())],
        });

        expect(await origins(recipe.id)).toStrictEqual([
            ['autoBest', lineIds[0]],
            [null, lineIds[1]],
        ]);
    });

    it('⛔ a different food on a line makes it `cook` and drops its link; the other line is untouched', async () => {
        const recipe = await draft();
        const { lineIds } = await snapshotLines(2);

        await pool.query(
            `UPDATE ingredients SET bound_by = 'exact', import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 0`,
            [recipe.id, lineIds[0]],
        );
        await pool.query(`UPDATE ingredients SET import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 1`, [
            recipe.id,
            lineIds[1],
        ]);

        await json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            ingredients: [{ ...patchLine(flourLine()), ingredientId: butter }, patchLine(spiceLine())],
        });

        expect(await origins(recipe.id)).toStrictEqual([
            ['cook', null],
            [null, lineIds[1]],
        ]);
    });

    it('turning the as-written line into a food is the cook’s decision: `cook`, and the link is gone', async () => {
        const recipe = await draft();
        const { lineIds } = await snapshotLines(1);

        await pool.query(`UPDATE ingredients SET import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 1`, [
            recipe.id,
            lineIds[0],
        ]);

        await json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            ingredients: [patchLine(flourLine()), { ...patchLine(spiceLine()), ingredientId: butter }],
        });

        expect(await origins(recipe.id)).toStrictEqual([
            ['cook', null],
            ['cook', null],
        ]);
    });

    it('deleting the import clears the link and keeps the line and the recipe (the link is provenance only)', async () => {
        const recipe = await draft();
        const { importId, lineIds } = await snapshotLines(1);

        await pool.query(
            `UPDATE ingredients SET bound_by = 'curated', import_line_id = $2 WHERE recipe_id = $1 AND sort_order = 0`,
            [recipe.id, lineIds[0]],
        );
        await pool.query(`DELETE FROM recipe_imports WHERE id = $1`, [importId]);

        expect(await origins(recipe.id)).toStrictEqual([
            ['curated', null],
            [null, null],
        ]);
    });

    it('refuses an origin outside the closed set at the database', async () => {
        const recipe = await draft();

        await expect(
            pool.query(`UPDATE ingredients SET bound_by = 'robot' WHERE recipe_id = $1 AND sort_order = 0`, [
                recipe.id,
            ]),
        ).rejects.toMatchObject({ code: '23514' });
    });
});
