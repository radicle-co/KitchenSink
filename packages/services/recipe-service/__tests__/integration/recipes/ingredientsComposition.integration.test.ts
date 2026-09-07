/**
 * T043b (integration) — recipe↔ingredient composition against the real Nest app + Docker Postgres.
 *
 * Proves the seam end to end over HTTP: `POST /api/v1/recipes` persists `recipe_ingredients` link rows for
 * each line (resolved against the seeded catalog), `GET /api/v1/recipes/{id}` composes them back into the
 * response `ingredients` array in author order, `PATCH` replaces the whole link set, and an unknown
 * `ingredientId` is rejected with 400 `UNKNOWN_INGREDIENT` rather than a raw FK 500. Skipped in lockstep
 * with the global setup when the harness DB is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { SEED_INGREDIENTS } from '../../../tests/globalSetup.js';

/** The dev-bypass owner ULID this suite creates recipes as. */
const OWNER = '01JCOMPOSE0OWNER0000000AAA';

const [FLOUR, SUGAR] = SEED_INGREDIENTS;

interface IngredientLine {
    ingredientId: string;
    name: string;
    quantity: number;
    unit?: string;
    notes?: string;
}

interface RecipeBody {
    id: string;
    currentVersion: number;
    ingredients: IngredientLine[];
}

const BASE_PAYLOAD = {
    title: 'Composition Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: [],
    dietaryFlags: [],
    steps: [{ instruction: 'Combine.' }],
};

describe.skipIf(!hasDatabaseUrl)('recipe↔ingredient composition (integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('persists ingredient links on create and composes them on read', async () => {
        const createResponse = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...BASE_PAYLOAD,
                ingredients: [
                    {
                        ingredientId: FLOUR.id,
                        name: FLOUR.name,
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        notes: 'sifted',
                    },
                    { ingredientId: SUGAR.id, name: SUGAR.name, quantity: { kind: 'exact', value: 1 }, unit: 'tbsp' },
                ],
            }),
        });
        expect(createResponse.status).toBe(201);
        const created = (await createResponse.json()) as RecipeBody;

        // Composed straight off the create response (persisted atomically with the recipe).
        expect(created.ingredients).toEqual([
            {
                ingredientId: FLOUR.id,
                name: 'Flour',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                notes: 'sifted',
                isUserEntered: true,
            },
            {
                ingredientId: SUGAR.id,
                name: 'Sugar',
                quantity: { kind: 'exact', value: 1 },
                unit: 'tbsp',
                isUserEntered: true,
            },
        ]);

        // ...and again on a fresh read (JOIN recipe_ingredients → ingredients).
        const getResponse = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`);
        expect(getResponse.status).toBe(200);
        const fetched = (await getResponse.json()) as RecipeBody;
        expect(fetched.ingredients.map((line) => line.ingredientId)).toEqual([FLOUR.id, SUGAR.id]);
    });

    it('replaces the whole link set on update', async () => {
        const created = (await (
            await fetch(`${baseUrl}/api/v1/recipes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    ...BASE_PAYLOAD,
                    ingredients: [
                        {
                            ingredientId: FLOUR.id,
                            name: FLOUR.name,
                            quantity: { kind: 'exact', value: 2 },
                            unit: 'cup',
                        },
                    ],
                }),
            })
        ).json()) as RecipeBody;

        const patchResponse = await fetch(`${baseUrl}/api/v1/recipes/${created.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                expectedVersion: created.currentVersion,
                ingredients: [
                    { ingredientId: SUGAR.id, name: SUGAR.name, quantity: { kind: 'exact', value: 3 }, unit: 'tsp' },
                ],
            }),
        });
        expect(patchResponse.status).toBe(200);

        const fetched = (await (await fetch(`${baseUrl}/api/v1/recipes/${created.id}`)).json()) as RecipeBody;
        expect(fetched.ingredients).toEqual([
            {
                ingredientId: SUGAR.id,
                name: 'Sugar',
                quantity: { kind: 'exact', value: 3 },
                unit: 'tsp',
                isUserEntered: true,
            },
        ]);
    });

    it('rejects an unknown ingredientId with 400 UNKNOWN_INGREDIENT', async () => {
        const response = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...BASE_PAYLOAD,
                ingredients: [
                    {
                        ingredientId: '00000000-0000-4000-8000-0000000000e9',
                        name: 'Ghost',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'cup',
                    },
                ],
            }),
        });

        expect(response.status).toBe(400);
        const body = (await response.json()) as { code: string };
        expect(body.code).toBe('UNKNOWN_INGREDIENT');
    });
});
