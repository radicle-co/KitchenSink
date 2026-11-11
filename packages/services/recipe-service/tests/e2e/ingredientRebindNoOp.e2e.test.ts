/**
 * A rebind whose target is the binding the line already holds, through the fully assembled app, a real Postgres and a
 * food-service fake (plan 002 U5; ADR-0045; LOCAL e2e under the 2026-09-20 ruling).
 *
 * REWRITTEN for ADR-0072 §5 (bulk import). "The same food is a no-op" is still true for a line with no recorded origin or
 * one the cook already owns (the first three cases, unchanged). It is NOT true for a line the import BOUND (`bound_by` is
 * `exact`, `curated`, `review`, `default` or `autoBest`): the cook picking that same food is the cook confirming it, so it
 * writes `cook`, mints a version and records the correction the cook taught. Without that, a flagged line could never be
 * cleared by choosing the food it already holds. The last `describe` proves it against the real columns.
 *
 * An editor adopts the version the command answers. What a mock cannot prove and these cases do: a stale
 * `expectedVersion` meets the enriched 409 with both conflict sides and writes nothing; a current one writes no
 * version, no line and no correction; and when another writer commits while food is asked, the answer still names the
 * version the caller sent, so the caller's next save meets that writer's change instead of overwriting it.
 *
 * The other writer is made deterministic by the food fake's {@link FoodFake.beforeNext} hold, which keeps the
 * command's first food request unanswered until a PATCH through the same app has committed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { versionConflictDetailsSchema } from '@kitchensink/recipe-core';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { bearerFor, startFoodFake, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-rebind-noop';
const AUTHOR = '01JREBINDNOOPE2E00AUTHOR00';
const BRISKET = `${SCOPE}-brisket`;

interface RecipeBody {
    readonly id: string;
    readonly title: string;
    readonly currentVersion: number;
    readonly ingredients: readonly { readonly ingredientId: string }[];
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;
let brisketLookup: string;

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

/** A recipe whose one line holds the brisket and carries `phrase`, an imported phrase a correction could teach. */
async function brisketRecipe(phrase: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} braise`,
        servings: 2,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        cuisine: 'Italian',
        ingredients: [
            {
                ingredientId: brisketLookup,
                quantity: { kind: 'exact', value: 500 },
                unit: 'g',
                sourceLine: `500 g ${phrase}`,
                sourcePhrase: phrase,
            },
        ],
        steps: [{ instruction: 'Braise.' }],
    });
}

/** Rebind line 0 to the brisket it already holds. */
async function rebindToSameFood(recipeId: string, expectedVersion: number): Promise<Response> {
    return call('POST', `/api/v1/recipes/${recipeId}/ingredients/0/rebind`, {
        expectedVersion,
        target: { kind: 'catalogFood', foodId: BRISKET },
    });
}

/** Everything a recipe write changes: the version, the row's timestamp, the version rows and the line rows. */
async function storedState(recipeId: string): Promise<unknown> {
    const { rows } = await pool.query(
        `SELECT r.current_version,
                r.updated_at::text AS updated_at,
                (SELECT count(*)::int FROM recipe_versions v WHERE v.recipe_id = r.id) AS versions,
                (SELECT array_agg(i.id::text || ':' || i.food_lookup_id::text ORDER BY i.sort_order)
                   FROM ingredients i WHERE i.recipe_id = r.id) AS lines
           FROM recipes r WHERE r.id = $1`,
        [recipeId],
    );

    return rows[0];
}

/** What the import-bound line's origin columns hold now. */
async function originOf(recipeId: string): Promise<{ bound_by: string | null; import_line_id: string | null }> {
    const { rows } = await pool.query(
        `SELECT bound_by, import_line_id::text AS import_line_id FROM ingredients WHERE recipe_id = $1 ORDER BY sort_order`,
        [recipeId],
    );

    return rows[0] as { bound_by: string | null; import_line_id: string | null };
}

/** The live corrections this cook holds for `phrase`. */
async function corrections(phrase: string): Promise<unknown[]> {
    const { rows } = await pool.query(
        `SELECT food_id FROM ingredient_resolution_mappings
          WHERE normalized_key = lower($1) AND user_id = $2 AND superseded_at IS NULL`,
        [phrase, AUTHOR],
    );

    return rows;
}

describe('a rebind that changes nothing (e2e, assembled app + food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(BRISKET, { name: 'Beef brisket', status: 'RESOLVED' });
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

    it('writes no version, line or correction for a current no-op, and answers the version sent', async () => {
        const phrase = `${SCOPE} current brisket`;
        const recipe = await brisketRecipe(phrase);
        const before = await storedState(recipe.id);

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as RecipeBody;

        expect(response.status).toBe(200);
        expect(body.currentVersion).toBe(recipe.currentVersion);
        expect(body.ingredients.map((line) => line.ingredientId)).toStrictEqual([brisketLookup]);
        expect(await storedState(recipe.id)).toStrictEqual(before);
        expect(await corrections(phrase)).toStrictEqual([]);
    });

    it('⛔ refuses a stale no-op with the enriched 409 — both conflict sides — and writes nothing', async () => {
        const phrase = `${SCOPE} stale brisket`;
        const recipe = await brisketRecipe(phrase);
        const edited = await json<RecipeBody>('PATCH', `/api/v1/recipes/${recipe.id}`, 200, {
            expectedVersion: recipe.currentVersion,
            title: `${SCOPE} edited elsewhere`,
        });
        const before = await storedState(recipe.id);

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as { code: string; details: unknown };
        const details = versionConflictDetailsSchema.parse(body.details);

        expect(response.status).toBe(409);
        expect(body.code).toBe('VERSION_CONFLICT');
        expect({
            currentVersion: details.currentVersion,
            conflictingVersion: details.conflictingVersion,
            server: [details.server.versionNumber, details.server.snapshot.title],
            base: [details.base?.versionNumber, details.base?.snapshot.title],
        }).toStrictEqual({
            currentVersion: edited.currentVersion,
            conflictingVersion: recipe.currentVersion,
            server: [edited.currentVersion, edited.title],
            base: [recipe.currentVersion, recipe.title],
        });
        expect(await storedState(recipe.id)).toStrictEqual(before);
        expect(await corrections(phrase)).toStrictEqual([]);
    });

    it('⛔ answers the version sent when another writer commits mid-command; the next save meets the 409', async () => {
        const recipe = await brisketRecipe(`${SCOPE} raced brisket`);
        const otherTitle = `${SCOPE} the other writer`;
        let otherWrite: number | undefined;

        food.beforeNext = async () => {
            otherWrite = (
                await call('PATCH', `/api/v1/recipes/${recipe.id}`, {
                    expectedVersion: recipe.currentVersion,
                    title: otherTitle,
                })
            ).status;
        };

        const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
        const body = (await response.json()) as RecipeBody;

        // Set only by the hold, so a 200 here also proves the hold ran.
        expect(otherWrite).toBe(200);
        expect(food.beforeNext).toBeUndefined();
        expect(response.status).toBe(200);
        expect(body.currentVersion).toBe(recipe.currentVersion);

        // The caller's next save, built on the version the command answered.
        const save = await call('PATCH', `/api/v1/recipes/${recipe.id}`, {
            expectedVersion: body.currentVersion,
            title: `${SCOPE} the cook's draft`,
        });

        expect(save.status).toBe(409);
        expect((await json<RecipeBody>('GET', `/api/v1/recipes/${recipe.id}`, 200)).title).toBe(otherTitle);
    });

    describe('a rebind to the same food on a line the bulk import bound (ADR-0072 §5; e2e, assembled app + food fake)', () => {
        /** A recipe whose one line the import auto-bound, with a link to a snapshot line that really exists. */
        async function importBoundRecipe(
            phrase: string,
            boundBy: string,
        ): Promise<{ recipe: RecipeBody; lineId: string }> {
            const recipe = await brisketRecipe(phrase);
            const imp = await pool.query<{ id: string }>(
                `INSERT INTO recipe_imports (user_id, match_mode, visibility, expected_total) VALUES ($1, 'bindBest', 'private', 1) RETURNING id`,
                [AUTHOR],
            );
            const importId = imp.rows[0]?.id ?? '';

            await pool.query(
                `INSERT INTO recipe_import_items (import_id, ordinal, title, payload, stage) VALUES ($1, 0, 'x', '{}'::jsonb, 'received')`,
                [importId],
            );
            const line = await pool.query<{ id: string }>(
                `INSERT INTO recipe_import_lines (import_id, ordinal, line_index, food_index, source_line, line_digest, judgement_digest, phrase, unit)
                 VALUES ($1, 0, 0, 0, $2, 'ld', 'jd', $3, 'g') RETURNING id`,
                [importId, `500 g ${phrase}`, phrase],
            );
            const lineId = line.rows[0]?.id ?? '';

            await pool.query(`UPDATE ingredients SET bound_by = $2, import_line_id = $3 WHERE recipe_id = $1`, [
                recipe.id,
                boundBy,
                lineId,
            ]);

            return { recipe, lineId };
        }

        it('⛔ writes `cook`, keeps the import link, mints exactly one version and teaches the correction', async () => {
            const phrase = `${SCOPE} import bound brisket`;
            const { recipe, lineId } = await importBoundRecipe(phrase, 'autoBest');
            const before = (await storedState(recipe.id)) as { versions: number };

            const response = await rebindToSameFood(recipe.id, recipe.currentVersion);
            const body = (await response.json()) as RecipeBody;

            expect(response.status).toBe(200);
            expect(body.currentVersion).toBe(recipe.currentVersion + 1);
            expect(await originOf(recipe.id)).toStrictEqual({ bound_by: 'cook', import_line_id: lineId });
            expect(((await storedState(recipe.id)) as { versions: number }).versions).toBe(before.versions + 1);
            expect(await corrections(phrase)).toHaveLength(1);
        });

        it('a second confirm of the now-cook line is a no-op again: no new version', async () => {
            const phrase = `${SCOPE} confirmed twice brisket`;
            const { recipe } = await importBoundRecipe(phrase, 'exact');
            const first = (await (await rebindToSameFood(recipe.id, recipe.currentVersion)).json()) as RecipeBody;
            const before = await storedState(recipe.id);

            const second = await rebindToSameFood(recipe.id, first.currentVersion);

            expect(second.status).toBe(200);
            expect(((await second.json()) as RecipeBody).currentVersion).toBe(first.currentVersion);
            expect(await storedState(recipe.id)).toStrictEqual(before);
        });
    });
});
