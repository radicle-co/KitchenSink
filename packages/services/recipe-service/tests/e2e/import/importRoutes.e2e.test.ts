/**
 * The bulk import's HTTP surface against a REAL database (LOCAL e2e, ADR-0072 §1): the booted app over HTTP, as one cook.
 *
 * What a mocked store cannot show, and this does:
 *
 *  - **The route reaches the SQL.** A cook creates an import, puts an item, advances, and reads the view: the item is saved
 *    and the view names the id of the recipe that was written.
 *  - **Ownership is the SQL's, not the route's.** A second cook reading, advancing or deleting the first cook's import gets
 *    `404`, and the first cook's import is untouched.
 *  - **A replayed create is the same import.** The client's id is the key (ADR-0072 §1): the same id answers the same
 *    import and stores no second copy.
 *
 * ⚠️ The parse job and the match live in another service's queue. This suite does what `importSave.e2e.test.ts` does: it
 * writes the snapshot an earlier advance would have left, and drives the SAVE through the route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { importViewSchema } from '@kitchensink/schema-recipe';

import { createRecipeDrizzle } from '../../../src/database/client.js';
import { RecipeImportItemsDal } from '../../../src/import/dal/recipeImportItems.dal.js';
import { ImportAllowanceDal } from '../../../src/common/dal/importAllowance.dal.js';
import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { deleteBindingsMatching } from '../../support/bindingCleanup.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-import-routes';
const COOK = '01JIMPORTROUTESE2E00000COOK';
const OTHER_COOK = '01JIMPORTROUTESE2E0000OTHER';
const FLOUR = `${SCOPE}-flour`;
const IMPORT_ID = crypto.randomUUID();

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;

const recipe = {
    title: `${SCOPE} pancakes`,
    cuisine: 'American',
    servings: 4,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredientLines: ['2 cups flour'],
    steps: [{ instruction: 'Mix and cook.' }],
};

const createBody = {
    id: IMPORT_ID,
    expectedTotal: 1,
    matchMode: 'bindBest',
    visibility: 'private',
    items: [{ ordinal: 0, recipe, statement: { kind: 'authored' } }],
};

async function call(
    cook: string,
    method: string,
    path: string,
    body?: unknown,
): Promise<{ status: number; json: unknown }> {
    const response = await asPrincipal(cook, () =>
        fetch(`${booted.baseUrl}/api/v1/import${path}`, {
            method,
            headers: { authorization: bearerFor(cook), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
    const text = await response.text();

    return { status: response.status, json: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set(FLOUR, { name: 'Wheat flour', status: 'RESOLVED' });
    process.env['FOOD_SERVICE_URL'] = food.origin;

    booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
    pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
});

afterAll(async () => {
    if (pool !== undefined) {
        await pool.query(`DELETE FROM recipes WHERE owner_id = ANY($1)`, [[COOK, OTHER_COOK]]);
        await pool.query(`DELETE FROM recipe_imports WHERE user_id = ANY($1)`, [[COOK, OTHER_COOK]]);
        await deleteBindingsMatching(pool, `${SCOPE}%`);
        await pool.end();
    }

    await booted?.close();
    await food?.close();
});

describe('the bulk import routes against a real database (LOCAL e2e)', () => {
    it('creates an import and stores its item', async () => {
        const { status, json } = await call(COOK, 'POST', '', createBody);

        expect(status).toBe(201);
        expect(importViewSchema.parse(json)).toMatchObject({
            id: IMPORT_ID,
            counts: { total: 1, received: 1, saved: 0 },
        });
    });

    it('⛔ replaying the same create id answers the same import and stores no second copy', async () => {
        const replay = await call(COOK, 'POST', '', createBody);
        const rows = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM recipe_imports WHERE user_id = $1`,
            [COOK],
        );

        expect(replay.status).toBe(201);
        expect(importViewSchema.parse(replay.json).id).toBe(IMPORT_ID);
        expect(rows.rows[0]?.n).toBe('1');
    });

    it('puts an item and reads it back through the view', async () => {
        const put = await call(COOK, 'PUT', `/${IMPORT_ID}/items`, {
            items: [{ ordinal: 0, recipe: { ...recipe, description: 'Fluffy.' } }],
        });
        const view = await call(COOK, 'GET', `/${IMPORT_ID}`);

        expect(put.status).toBe(200);
        expect(view.status).toBe(200);
        expect(importViewSchema.parse(view.json).items).toHaveLength(1);
    });

    it('⛔ a second cook gets 404 on every read and write of the first cook’s import', async () => {
        for (const [method, path, body] of [
            ['GET', `/${IMPORT_ID}`, undefined],
            ['POST', `/${IMPORT_ID}/advance`, {}],
            ['POST', `/${IMPORT_ID}/leave`, {}],
            ['DELETE', `/${IMPORT_ID}`, undefined],
        ] as const) {
            const { status } = await call(OTHER_COOK, method, path, body);

            expect(status, `${method} ${path}`).toBe(404);
        }

        expect(importViewSchema.parse((await call(COOK, 'GET', `/${IMPORT_ID}`)).json).id).toBe(IMPORT_ID);
    });

    it('advances to a saved recipe and the view names it', async () => {
        // The parse job and the match are another service's work: leave the snapshot an earlier advance would have.
        const db = createRecipeDrizzle(pool);
        const items = new RecipeImportItemsDal(db, new ImportAllowanceDal());

        await pool.query(
            `UPDATE recipe_import_items SET stage = 'parsing', allowance_spent_at = now() WHERE import_id = $1`,
            [IMPORT_ID],
        );
        await items.snapshot(IMPORT_ID, 0, [
            {
                lineIndex: 0,
                foodIndex: 0,
                sourceLine: '2 cups flour',
                lineDigest: 'ld-flour',
                judgementDigest: 'jd-flour',
                phrase: 'flour',
                quantity: '2',
                quantityHigh: null,
                unit: 'cup',
                statedQuantity: null,
                statedQuantityHigh: null,
                statedUnit: null,
                preparation: null,
                name: 'flour',
                displayText: null,
                note: null,
                matchedBy: 'lexical',
                foodId: FLOUR,
                foodVariantId: null,
                rung: 'head',
                margin: 0.4,
                candidates: [{ kind: 'root', id: FLOUR, rung: 'head', isDefault: false }],
                verificationKey: `${SCOPE}-key`,
                review: 'owed',
            },
        ]);

        let saved: string | null = null;

        // Each advance does a bounded step; a few is more than one item needs.
        for (let step = 0; step < 3 && saved === null; step += 1) {
            const { status, json } = await call(COOK, 'POST', `/${IMPORT_ID}/advance`, {});

            expect(status).toBe(200);
            saved = importViewSchema.parse(json).items[0]?.recipeId ?? null;
        }

        const written = await pool.query<{ id: string; owner_id: string }>(
            `SELECT id::text AS id, owner_id FROM recipes WHERE owner_id = $1 AND title = $2`,
            [COOK, recipe.title],
        );

        expect(written.rows).toHaveLength(1);
        expect(saved).toBe(written.rows[0]?.id);
        expect(importViewSchema.parse((await call(COOK, 'GET', `/${IMPORT_ID}`)).json).counts).toMatchObject({
            saved: 1,
        });
    });

    it('deletes the import and keeps the saved recipe', async () => {
        const { status } = await call(COOK, 'DELETE', `/${IMPORT_ID}`);
        const recipes = await pool.query(`SELECT 1 FROM recipes WHERE owner_id = $1 AND title = $2`, [
            COOK,
            recipe.title,
        ]);

        expect(status).toBe(204);
        expect((await call(COOK, 'GET', `/${IMPORT_ID}`)).status).toBe(404);
        expect(recipes.rowCount).toBe(1);
    });
});
