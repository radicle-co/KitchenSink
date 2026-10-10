/**
 * `POST /api/v1/recipes/{id}/ingredients/{position}/rebind` through the fully assembled app, a real Postgres and a
 * food-service fake (plan 002 U5: R14, R17, AE3, AE6, AE9, AE11; LOCAL e2e under the 2026-09-20 ruling).
 *
 * What a mock cannot prove and these cases do: the correction row really lands in the one corrections store, the
 * line really moves while every fact about it stays, the version compare-and-swap really refuses a stale edit before
 * anything is written, and the binding the line left is really deleted — only when nothing else uses it.
 *
 * ⚠️ The moved line LOSES its transcription (source line, phrase and stated measure), by the carry-forward rule every
 * update follows: a line whose binding changed is a different judgement, and a cook's pick is not our parse to be
 * verified against the source. The case below pins that on purpose; every other line keeps its transcription.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-rebind';
const AUTHOR = '01JREBINDE2E000000AUTHOR00';
const BRISKET = `${SCOPE}-brisket`;
const SHOULDER = `${SCOPE}-shoulder`;
const OWN_BLEND = `${SCOPE}-own-blend`;

interface LineBody {
    readonly ingredientId: string;
    readonly name?: string;
    readonly quantity: unknown;
    readonly unit?: string;
    readonly preparation?: string;
    readonly groupLabel?: string;
    readonly unresolvedReason?: string;
}

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly ingredients: readonly LineBody[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let brisketLookup: string;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(AUTHOR, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(AUTHOR), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
}

async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await call(method, path, body);
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${response.status}, expected ${expected}: ${text}`);
    }

    return JSON.parse(text) as T;
}

/** A binding for a name food does not know: a failure record the cook's line can point at. */
async function unmatched(phrase: string): Promise<string> {
    return (await json<{ id: string }>('POST', '/api/v1/ingredients/by-name', 202, { name: phrase })).id;
}

/** A recipe whose line 0 is `first` (with a transcription) and line 1 is the brisket (with its own). */
async function recipeWith(first: string, phrase: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${phrase}`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: [
            {
                ingredientId: first,
                quantity: { kind: 'range', low: 1, high: 2 },
                unit: 'cup',
                preparation: 'minced',
                groupLabel: 'Sauce',
                sourceLine: `1-2 cups ${phrase}, minced`,
                sourcePhrase: phrase,
            },
            {
                ingredientId: brisketLookup,
                quantity: { kind: 'exact', value: 500 },
                unit: 'g',
                sourceLine: '500 g beef brisket',
                sourcePhrase: 'beef brisket',
            },
        ],
        steps: [{ instruction: 'Cook.' }],
    });
}

/** The live corrections this cook holds for a phrase. */
async function correctionsFor(phrase: string): Promise<{ food_id: string; scope: string; surfacing: string }[]> {
    const { rows } = await pool.query<{ food_id: string; scope: string; surfacing: string }>(
        `SELECT food_id, scope, surfacing FROM ingredient_resolution_mappings
          WHERE normalized_key = lower($1) AND user_id = $2 AND superseded_at IS NULL`,
        [phrase, AUTHOR],
    );

    return rows;
}

async function lookupExists(id: string): Promise<boolean> {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM food_lookups WHERE id = $1`, [id]);

    return (rows[0]?.n ?? 0) > 0;
}

describe('rebinding a recipe line (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(BRISKET, { name: 'Beef brisket', status: 'RESOLVED' });
        food.foods.set(SHOULDER, { name: 'Pork shoulder', status: 'RESOLVED' });
        food.foods.set(OWN_BLEND, { name: 'My secret blend', status: 'RESOLVED', ownerId: AUTHOR });
        food.names.set('pork shoulder', SHOULDER);
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
        brisketLookup = (await json<{ id: string }>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BRISKET }))
            .id;
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [AUTHOR]);
            await pool.query(`DELETE FROM ingredient_resolution_mappings WHERE user_id = $1`, [AUTHOR]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('corrects, moves the line keeping its facts, mints a version, and deletes the failure it left (AE3, AE9, AE11)', async () => {
        const phrase = `${SCOPE} flibbertigibbet`;
        const failure = await unmatched(phrase);
        const recipe = await recipeWith(failure, phrase);

        const rebound = await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'catalogFood', foodId: SHOULDER },
        });

        expect(rebound.currentVersion).toBe(recipe.currentVersion + 1);
        expect(rebound.ingredients[0]).toMatchObject({
            name: 'Pork shoulder',
            quantity: { kind: 'range', low: 1, high: 2 },
            unit: 'cup',
            preparation: 'minced',
            groupLabel: 'Sauce',
        });
        expect(rebound.ingredients[1]).toMatchObject({ ingredientId: brisketLookup, name: 'Beef brisket' });
        expect(await correctionsFor(phrase)).toStrictEqual([
            { food_id: SHOULDER, scope: 'author', surfacing: 'row_rebind' },
        ]);
        expect(await lookupExists(failure)).toBe(false);

        const { rows: lines } = await pool.query<{ source_line: string | null }>(
            `SELECT source_line FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
            [recipe.id],
        );
        const { rows: versions } = await pool.query<{ change_summary: string }>(
            `SELECT change_summary FROM recipe_versions WHERE recipe_id = $1 AND version_number = $2`,
            [recipe.id, rebound.currentVersion],
        );

        expect(lines.map((line) => line.source_line)).toStrictEqual([null, '500 g beef brisket']);
        expect(versions[0]?.change_summary).toBe('Changed ingredient');
    });

    it('⛔ records NO correction when the new name still fails, and the line shows the new reason (AE6)', async () => {
        const phrase = `${SCOPE} zzyzx`;
        const recipe = await recipeWith(await unmatched(phrase), phrase);

        const rebound = await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'name', name: `${SCOPE} quux` },
        });

        expect(rebound.ingredients[0]).toMatchObject({ name: `${SCOPE} quux` });
        expect(rebound.ingredients[0]?.unresolvedReason).toBeDefined();
        expect(await correctionsFor(phrase)).toStrictEqual([]);
    });

    it('⛔ refuses a name target with 502 while food is down — the line, the version and the corrections stay', async () => {
        const phrase = `${SCOPE} outage`;
        const failure = await unmatched(phrase);
        const recipe = await recipeWith(failure, phrase);

        food.down = true;

        try {
            const response = await call('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, {
                expectedVersion: recipe.currentVersion,
                target: { kind: 'name', name: `${SCOPE} yuzu kosho` },
            });

            expect(response.status).toBe(502);
            expect(await response.json()).toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
        } finally {
            food.down = false;
        }

        const { rows } = await pool.query<{ food_lookup_id: string; current_version: number }>(
            `SELECT i.food_lookup_id, r.current_version FROM ingredients i JOIN recipes r ON r.id = i.recipe_id
              WHERE r.id = $1 AND i.sort_order = 0`,
            [recipe.id],
        );

        expect(rows[0]).toStrictEqual({ food_lookup_id: failure, current_version: recipe.currentVersion });
        expect(await correctionsFor(phrase)).toStrictEqual([]);
    });

    it('resolves a name through food and teaches the phrase when it matches', async () => {
        const phrase = `${SCOPE} pulled pork`;
        const recipe = await recipeWith(await unmatched(phrase), phrase);

        const rebound = await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'name', name: 'Pork shoulder' },
        });

        expect(rebound.ingredients[0]?.name).toBe('Pork shoulder');
        expect((await correctionsFor(phrase)).map((row) => row.food_id)).toStrictEqual([SHOULDER]);
    });

    it('⛔ keeps a correction to the cook’s OWN private food personal — never shared', async () => {
        const phrase = `${SCOPE} secret blend`;
        const recipe = await recipeWith(await unmatched(phrase), phrase);

        await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'catalogFood', foodId: OWN_BLEND },
        });

        expect(await correctionsFor(phrase)).toStrictEqual([
            { food_id: OWN_BLEND, scope: 'author', surfacing: 'row_rebind' },
        ]);
    });

    it('⛔ refuses a stale version with the enriched 409, writing NOTHING — no correction, no move', async () => {
        const phrase = `${SCOPE} stale`;
        const failure = await unmatched(phrase);
        const recipe = await recipeWith(failure, phrase);

        const response = await call('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, {
            expectedVersion: recipe.currentVersion + 7,
            target: { kind: 'catalogFood', foodId: SHOULDER },
        });
        const body = (await response.json()) as { code: string; details: { currentVersion: number } };

        expect(response.status).toBe(409);
        expect(body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: recipe.currentVersion } });
        expect(await correctionsFor(phrase)).toStrictEqual([]);
        expect((await json<RecipeBody>('GET', `/api/v1/recipes/${recipe.id}`, 200)).ingredients[0]?.ingredientId).toBe(
            failure,
        );
    });

    it('⛔ keeps a failure another recipe still uses — only an orphan is deleted (AE9 control)', async () => {
        const phrase = `${SCOPE} shared failure`;
        const failure = await unmatched(phrase);
        const moved = await recipeWith(failure, phrase);
        const other = await recipeWith(await unmatched(phrase), phrase);

        expect(other.ingredients[0]?.ingredientId).toBe(failure);

        await json<RecipeBody>('POST', `/api/v1/recipes/${moved.id}/ingredients/0/rebind`, 200, {
            expectedVersion: moved.currentVersion,
            target: { kind: 'catalogFood', foodId: SHOULDER },
        });

        expect(await lookupExists(failure)).toBe(true);
    });

    it('refuses a position with no line as a validation failure', async () => {
        const phrase = `${SCOPE} out of range`;
        const recipe = await recipeWith(await unmatched(phrase), phrase);

        const response = await call('POST', `/api/v1/recipes/${recipe.id}/ingredients/9/rebind`, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'catalogFood', foodId: SHOULDER },
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
});
