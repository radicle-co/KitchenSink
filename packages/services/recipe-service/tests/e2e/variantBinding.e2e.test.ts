/**
 * A recipe line bound to a VARIANT, through the fully assembled app, a real Postgres and a food-service fake (curated
 * plan U9; R20–R23, R29; AE1; LOCAL e2e under the 2026-09-20 ruling).
 *
 * What only this tier proves: the variant arm really lands in `food_lookups` and in the resolution memory, a detail
 * read really composes the variant and its own numbers from food's answers, and the cascade really binds a variant
 * from a correction, a memo and a search hit.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | AE1, R20 | binding a variant stores the variant arm; the line shows its root's name, the live root and its parts |
 * | R21 | a variant line counts the variant's own numbers, and a change to its root's numbers leaves it alone |
 * | R22 | changing and removing a line's variant persist |
 * | R23 | a phrase whose words name exactly one variant binds that variant |
 * | R29 | a line bound to a variant or root the seed retired with no successor keeps its name and numbers |
 * | forward | a binding made before food forwarded the variant reads the forward's target |
 * | the memory's arc | a correction and a memo naming a variant bind that variant on the next add |
 *
 * Every food id carries {@link SCOPE}, and every row this file writes is removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { asPrincipal } from '../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FakeFood, type FoodFake } from '../support/foodFake.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const SCOPE = 'e2e-variant-bind';
const COOK = '01JVARIANTBINDE2E000COOK00';

const BRISKET = `${SCOPE}-brisket`;
const FLAT = `${SCOPE}-flat`;
const POINT = `${SCOPE}-point`;
const TOMATO = `${SCOPE}-tomato`;
const PASTE = `${SCOPE}-paste`;
const CHUCK = `${SCOPE}-chuck`;
const CHUCK_STEAK = `${SCOPE}-chuck-steak`;

const FLAT_PARTS = [{ attribute: 'cut', text: 'flat' }];
const POINT_PARTS = [{ attribute: 'cut', text: 'point' }];
const PASTE_PARTS = [{ attribute: 'form', text: 'paste' }];

interface LineBody {
    readonly ingredientId: string;
    readonly name?: string;
    readonly foodId?: string;
    readonly variant?: { readonly id: string; readonly parts: readonly unknown[] };
    readonly hasVariants?: boolean;
}

interface RecipeBody {
    readonly id: string;
    readonly currentVersion: number;
    readonly ingredients: readonly LineBody[];
    readonly nutrition?: { readonly calories?: number; readonly isComplete: boolean };
}

interface IngredientBody {
    readonly id: string;
    readonly name: string;
    readonly foodId?: string;
    readonly variant?: { readonly id: string; readonly parts: readonly unknown[] };
}

let booted: BootedRecipeApp;
let pool: pg.Pool;
let food: FoodFake;

/**
 * Call the app as the cook, forwarding the cook's bearer to food.
 *
 * @sideEffect One HTTP request.
 */
async function json<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
    const response = await asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { authorization: bearerFor(COOK), 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    );
    const text = await response.text();

    if (response.status !== expected) {
        throw new Error(`${method} ${path} answered ${String(response.status)}, expected ${String(expected)}: ${text}`);
    }

    return JSON.parse(text) as T;
}

/** Bind a variant through the picker's door. */
async function bindVariant(foodVariantId: string): Promise<IngredientBody> {
    return json<IngredientBody>('POST', '/api/v1/ingredients/by-food-variant', 200, { foodVariantId });
}

/** Insert a binding directly, standing in for one made before food changed what it answers. */
async function insertedBinding(column: 'food_id' | 'food_variant_id', id: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(`INSERT INTO food_lookups (${column}) VALUES ($1) RETURNING id`, [
        id,
    ]);

    return rows[0]?.id ?? '';
}

/** A one-serving recipe with 100 g of each binding, so its calories are the sum of each food's per-100 g figure. */
async function recipeOf(label: string, bindings: readonly string[], phrase?: string): Promise<RecipeBody> {
    return json<RecipeBody>('POST', '/api/v1/recipes', 201, {
        title: `${SCOPE} ${label}`,
        servings: 1,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
        totalTimeMinutes: 15,
        ingredients: bindings.map((ingredientId) => ({
            ingredientId,
            quantity: { kind: 'exact', value: 100 },
            unit: 'g',
            ...(phrase === undefined ? {} : { sourceLine: `100 g ${phrase}`, sourcePhrase: phrase }),
        })),
        steps: [{ instruction: 'Cook.' }],
    });
}

/** Read a recipe's detail as the cook. */
async function detailOf(id: string): Promise<RecipeBody> {
    return json<RecipeBody>('GET', `/api/v1/recipes/${id}`, 200);
}

/** Replace one fake food, keeping its other facts. */
function amend(id: string, change: Partial<FakeFood>): void {
    const current = food.foods.get(id);

    if (current === undefined) {
        throw new Error(`the fake holds no food ${id}`);
    }

    food.foods.set(id, { ...current, ...change });
}

describe('variant-bound recipe lines (e2e, LOCAL: assembled app, real Postgres, food fake)', () => {
    beforeAll(async () => {
        food = await startFoodFake();
        food.foods.set(BRISKET, { name: `${SCOPE} brisket`, status: 'RESOLVED', caloriesPer100g: 170 });
        food.foods.set(FLAT, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 155,
            variantOf: { rootId: BRISKET, parts: FLAT_PARTS },
        });
        food.foods.set(POINT, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 200,
            variantOf: { rootId: BRISKET, parts: POINT_PARTS },
        });
        food.foods.set(TOMATO, { name: `${SCOPE} tomato`, status: 'RESOLVED', caloriesPer100g: 18 });
        food.foods.set(PASTE, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 82,
            variantOf: { rootId: TOMATO, parts: PASTE_PARTS },
        });
        food.foods.set(CHUCK, { name: `${SCOPE} chuck`, status: 'RESOLVED', caloriesPer100g: 250 });
        food.foods.set(CHUCK_STEAK, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 180,
            variantOf: { rootId: CHUCK, parts: [{ attribute: 'cut', text: 'steak' }] },
        });
        process.env['FOOD_SERVICE_URL'] = food.origin;

        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: COOK });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 4 });
    });

    afterAll(async () => {
        if (pool !== undefined) {
            await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [COOK]);
            await pool.query(`DELETE FROM ingredient_resolution_mappings WHERE user_id = $1`, [COOK]);
            await pool.query(`DELETE FROM ingredient_resolution_memos WHERE normalized_key LIKE $1`, [`${SCOPE}%`]);
            await deleteBindingsMatching(pool, `${SCOPE}%`);
            await pool.end();
        }

        await booted?.close();
        await food?.close();
    });

    it('AE1/R20: binds the variant arm, and the line shows its root’s name, the live root and its parts', async () => {
        const bound = await bindVariant(FLAT);
        const { rows } = await pool.query<{ food_id: string | null; food_variant_id: string | null }>(
            `SELECT food_id, food_variant_id FROM food_lookups WHERE id = $1`,
            [bound.id],
        );
        const recipe = await recipeOf('ae1', [bound.id]);

        expect(rows).toStrictEqual([{ food_id: null, food_variant_id: FLAT }]);
        expect(recipe.ingredients[0]).toMatchObject({
            ingredientId: bound.id,
            name: `${SCOPE} brisket`,
            foodId: BRISKET,
            variant: { id: FLAT, parts: FLAT_PARTS },
        });
        expect(recipe.ingredients[0]).not.toHaveProperty('hasVariants');
        // R21: the flat's own 155, not its root's 170.
        expect((await detailOf(recipe.id)).nutrition?.calories).toBe(155);
    });

    it('the picker’s nutrition read answers a variant with the variant’s own numbers', async () => {
        const answer = await json<{ entries: readonly { outcome: string; caloriesPer100g?: number }[] }>(
            'POST',
            '/api/v1/ingredients/food-nutrition',
            200,
            { refs: [{ kind: 'variant', id: FLAT }] },
        );

        expect(answer.entries).toMatchObject([{ outcome: 'found', caloriesPer100g: 155 }]);
    });

    it('the picker’s nutrition read says whether a ROOT has a live variant, and never says it of a variant', async () => {
        const lone = `${SCOPE}-lone-root`;

        food.foods.set(lone, { name: `${SCOPE} lone`, status: 'RESOLVED', caloriesPer100g: 90 });

        const answer = await json<{ entries: readonly Record<string, unknown>[] }>(
            'POST',
            '/api/v1/ingredients/food-nutrition',
            200,
            {
                refs: [
                    { kind: 'root', id: BRISKET },
                    { kind: 'root', id: lone },
                    { kind: 'variant', id: FLAT },
                ],
            },
        );

        expect(answer.entries).toMatchObject([
            { outcome: 'found', ref: { kind: 'root', id: BRISKET }, hasVariants: true },
            { outcome: 'found', ref: { kind: 'root', id: lone }, hasVariants: false },
            { outcome: 'found', ref: { kind: 'variant', id: FLAT } },
        ]);
        expect(answer.entries[2]).not.toHaveProperty('hasVariants');
    });

    it('⛔ R21: a change to the ROOT’s numbers moves a root line and leaves a variant line alone', async () => {
        const variantRecipe = await recipeOf('r21 variant', [(await bindVariant(CHUCK_STEAK)).id]);

        amend(CHUCK, { caloriesPer100g: 400 });

        const rootBinding = await json<IngredientBody>('POST', '/api/v1/ingredients/by-food', 200, {
            foodId: CHUCK,
        });
        const rootRecipe = await recipeOf('r21 root', [rootBinding.id]);

        // The positive control: the root's new figure reaches a root line.
        expect((await detailOf(rootRecipe.id)).nutrition?.calories).toBe(400);
        expect((await detailOf(variantRecipe.id)).nutrition?.calories).toBe(180);
    });

    it('R22: changing a line to a variant and removing it again both persist, each as a new version', async () => {
        const root = await json<IngredientBody>('POST', '/api/v1/ingredients/by-food', 200, { foodId: BRISKET });
        const recipe = await recipeOf('r22', [root.id]);

        expect(recipe.ingredients[0]).toMatchObject({ foodId: BRISKET, hasVariants: true });

        const changed = await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'catalogVariant', foodVariantId: POINT },
        });
        const changedRead = await detailOf(recipe.id);

        expect(changed.currentVersion).toBe(recipe.currentVersion + 1);
        expect(changedRead.ingredients[0]).toMatchObject({
            foodId: BRISKET,
            variant: { id: POINT, parts: POINT_PARTS },
        });
        expect(changedRead.nutrition?.calories).toBe(200);

        const removed = await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: changed.currentVersion,
            target: { kind: 'catalogFood', foodId: BRISKET },
        });
        const removedRead = await detailOf(recipe.id);

        expect(removed.currentVersion).toBe(changed.currentVersion + 1);
        expect(removedRead.ingredients[0]).toMatchObject({ foodId: BRISKET, hasVariants: true });
        expect(removedRead.ingredients[0]).not.toHaveProperty('variant');
        expect(removedRead.nutrition?.calories).toBe(170);
    });

    it('R23: a phrase whose words name exactly one variant binds that variant through the search tier', async () => {
        const bound = await json<IngredientBody>('POST', '/api/v1/ingredients/by-name', 202, {
            name: `${SCOPE} brisket flat`,
        });

        expect(bound).toMatchObject({ foodId: BRISKET, variant: { id: FLAT, parts: FLAT_PARTS } });
    });

    it('the positive control for R23: a phrase naming the root alone binds the root, with no variant', async () => {
        const bound = await json<IngredientBody>('POST', '/api/v1/ingredients/by-name', 202, {
            name: `${SCOPE} brisket`,
        });

        expect(bound).toMatchObject({ foodId: BRISKET });
        expect(bound).not.toHaveProperty('variant');
    });

    it('a binding made before food forwarded its variant reads the forward’s TARGET, parts and numbers', async () => {
        const moving = `${SCOPE}-moving`;

        food.foods.set(moving, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 999,
            variantOf: { rootId: BRISKET, parts: [{ attribute: 'cut', text: 'whole' }] },
        });

        const recipe = await recipeOf('forward', [(await bindVariant(moving)).id]);

        amend(moving, { retired: true, forwardedTo: { kind: 'variant', id: POINT } });

        const read = await detailOf(recipe.id);

        expect(read.ingredients[0]).toMatchObject({ foodId: BRISKET, variant: { id: POINT, parts: POINT_PARTS } });
        expect(read.nutrition?.calories).toBe(200);
    });

    it('⛔ R29: a line bound to a variant the seed retired with no successor keeps its name, parts and numbers', async () => {
        const gone = `${SCOPE}-gone-cut`;

        food.foods.set(gone, {
            name: null,
            status: 'RESOLVED',
            caloriesPer100g: 260,
            retired: true,
            variantOf: { rootId: BRISKET, parts: [{ attribute: 'cut', text: 'deckle' }] },
        });

        const read = await detailOf(
            (await recipeOf('r29 variant', [await insertedBinding('food_variant_id', gone)])).id,
        );

        expect(read.ingredients[0]).toMatchObject({
            name: `${SCOPE} brisket`,
            foodId: BRISKET,
            variant: { id: gone, parts: [{ attribute: 'cut', text: 'deckle' }] },
        });
        expect(read.nutrition?.calories).toBe(260);
    });

    it('⛔ R29 for a ROOT (owner, 2026-10-01): a line bound to a retired root keeps its name and numbers', async () => {
        const goneRoot = `${SCOPE}-gone-root`;

        food.foods.set(goneRoot, {
            name: `${SCOPE} old brisket`,
            status: 'RESOLVED',
            caloriesPer100g: 300,
            retired: true,
        });

        const read = await detailOf((await recipeOf('r29 root', [await insertedBinding('food_id', goneRoot)])).id);

        expect(read.ingredients[0]).toMatchObject({
            name: `${SCOPE} old brisket`,
            foodId: goneRoot,
            hasVariants: false,
        });
        expect(read.nutrition?.calories).toBe(300);
    });

    it('concurrent binds of one variant converge on ONE binding row', async () => {
        const answers = await Promise.all(Array.from({ length: 6 }, () => bindVariant(POINT)));
        const { rows } = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM food_lookups WHERE food_variant_id = $1`,
            [POINT],
        );

        expect(new Set(answers.map((answer) => answer.id)).size).toBe(1);
        expect(rows[0]?.n).toBe(1);
    });

    it('a rebind to a variant writes the variant arc, and the cook’s next add of that phrase binds the variant', async () => {
        const phrase = `${SCOPE} red stuff`;
        const failure = await json<IngredientBody>('POST', '/api/v1/ingredients/by-name', 202, { name: phrase });
        const recipe = await recipeOf('curated', [failure.id], phrase);

        await json<RecipeBody>('POST', `/api/v1/recipes/${recipe.id}/ingredients/0/rebind`, 200, {
            expectedVersion: recipe.currentVersion,
            target: { kind: 'catalogVariant', foodVariantId: PASTE },
        });

        const { rows } = await pool.query<{ food_id: string | null; food_variant_id: string | null }>(
            `SELECT food_id, food_variant_id FROM ingredient_resolution_mappings
              WHERE normalized_key = $1 AND user_id = $2 AND superseded_at IS NULL`,
            [normalizedIngredientKey(phrase), COOK],
        );
        const next = await json<IngredientBody>('POST', '/api/v1/ingredients/by-name', 202, { name: phrase });

        expect(rows).toStrictEqual([{ food_id: null, food_variant_id: PASTE }]);
        expect(next).toMatchObject({ foodId: TOMATO, variant: { id: PASTE, parts: PASTE_PARTS } });
    });

    it('a memo naming a variant binds that variant on the next add of its phrase', async () => {
        const phrase = `${SCOPE} concentrate`;

        await pool.query(
            `INSERT INTO ingredient_resolution_memos (normalized_key, food_variant_id, source_phrase, verified_by)
             VALUES ($1, $2, $3, 'e2e-model')`,
            [normalizedIngredientKey(phrase), PASTE, phrase],
        );

        const bound = await json<IngredientBody>('POST', '/api/v1/ingredients/by-name', 202, { name: phrase });

        expect(bound).toMatchObject({ foodId: TOMATO, variant: { id: PASTE, parts: PASTE_PARTS } });
    });
});
