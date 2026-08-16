/**
 * The deferred calorie lookup end to end, over HTTP, against the fully ASSEMBLED app (real Nest + Docker
 * Postgres, dev-auth bypass) — recipes CREATED through the public write path, then asked about through
 * `POST /api/v1/recipes/nutrition-batch`.
 *
 * The axis this adds over `__tests__/integration/recipes/nutritionBatch.integration.test.ts`, which seeds
 * rows directly: everything here goes through the REAL create endpoint, so the batch read is proven
 * against rows the service itself wrote — the ingredient links, the serving count and the visibility a
 * client actually produces. A row hand-built in a spec can satisfy a read that the write path could never
 * have produced.
 *
 * It also pins the two client-visible HTTP facts that no in-process test can: the status codes, and that
 * the 400 body is the PUBLISHED envelope (`code` + `details.fields`) rather than whatever the framework
 * happened to build.
 *
 * ⚠️ No food origin is stubbed here, deliberately. `FOOD_SERVICE_URL` points at nothing reachable, so the
 * gateway takes its cold-cache degrade path — which makes this suite the proof that a food OUTAGE still
 * answers `200` with a terminal `unaccounted` state per recipe, rather than failing the read. That is the
 * behaviour a card grid depends on, and it is the one a stub can never demonstrate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';
import { MAX_NUTRITION_RECIPE_IDS } from '../../src/recipes/recipes.schema.js';

const OWNER = '01JNUTRITIONBATCHE2EOWNER01';

/** The seeded catalog ingredient every recipe here references (see `src/database/seed.ts`). */
const SEED_INGREDIENT_FLOUR = '00000000-0000-4000-8000-0000000000aa';

/** One recipe's state on the wire. */
type NutritionState =
    | {
          state: 'known';
          caloriesPerServing: number;
          proteinG: number;
          carbsG: number;
          fatG: number;
          isComplete: boolean;
          freshness: 'fresh' | 'stale';
      }
    | { state: 'unaccounted'; reason: string };

interface NutritionBody {
    nutrition: Record<string, NutritionState>;
}

describe.skipIf(!hasDatabaseUrl)('POST /api/v1/recipes/nutrition-batch (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let firstRecipeId: string;
    let secondRecipeId: string;

    /** Create a recipe through the PUBLIC write path and return its id. */
    async function createRecipe(title: string): Promise<string> {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title,
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [{ ingredientId: SEED_INGREDIENT_FLOUR, name: 'Flour', quantity: 200, unit: 'g' }],
                steps: [{ instruction: 'Mix.' }],
            }),
        });

        expect(response.status).toBe(201);

        return ((await response.json()) as { id: string }).id;
    }

    async function askFor(recipeIds: readonly string[]): Promise<Response> {
        return fetch(`${booted.baseUrl}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeIds }),
        });
    }

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        firstRecipeId = await createRecipe('Nutrition Batch E2E One');
        secondRecipeId = await createRecipe('Nutrition Batch E2E Two');
    });

    afterAll(async () => {
        await booted?.close();
    });

    it('answers 200 with one entry per requested recipe', async () => {
        const response = await askFor([firstRecipeId, secondRecipeId]);

        expect(response.status).toBe(200);
        const body = (await response.json()) as NutritionBody;

        expect(Object.keys(body.nutrition).sort()).toStrictEqual([firstRecipeId, secondRecipeId].sort());
    });

    it('⛔ answers 200 with a TERMINAL state while food is unreachable — never an error, never a 0', async () => {
        // KTD-3b's cold-cache branch, asserted on the client-visible outcome. The whole point of the wire
        // union having no `pending` member is that a card can always stop waiting: a food outage must
        // produce an ANSWER. `unaccounted` carries no figure, so nothing can be rendered as "0 cal".
        const body = (await (await askFor([firstRecipeId])).json()) as NutritionBody;
        const state = body.nutrition[firstRecipeId];

        expect(state?.state).toBe('unaccounted');
        expect(state).not.toHaveProperty('caloriesPerServing');
    });

    it('⛔ OMITS an id that does not exist — absence is the answer, not a 404', async () => {
        // A batch read cannot 404 on one bad id without telling the caller which ids DO exist. Omission is
        // the same signal an unreadable recipe gets, which is what makes the two indistinguishable.
        const unknown = '00000000-0000-4000-8000-0000000ffff1';
        const body = (await (await askFor([firstRecipeId, unknown])).json()) as NutritionBody;

        expect(Object.keys(body.nutrition)).toStrictEqual([firstRecipeId]);
    });

    it('⛔ rejects an over-cap list with the PUBLISHED 400 envelope, naming the field', async () => {
        const tooMany = Array.from(
            { length: MAX_NUTRITION_RECIPE_IDS + 1 },
            (_value, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
        );
        const response = await askFor(tooMany);

        expect(response.status).toBe(400);
        const body = (await response.json()) as { code: string; message: string; details?: { fields?: string[] } };

        expect(body.code).toBe('VALIDATION_FAILED');
        expect(body.details?.fields?.join(' ')).toContain('recipeIds');
    });

    it('rejects a malformed recipe id with a 400 rather than passing it to the query', async () => {
        expect((await askFor(['not-a-uuid'])).status).toBe(400);
    });

    it('⛔ rejects a smuggled `ownerId` — the reader is the token, and the body is strict', async () => {
        const response = await fetch(`${booted.baseUrl}/api/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeIds: [firstRecipeId], ownerId: '01JHOSTILE0000000000000000' }),
        });

        expect(response.status).toBe(400);
    });

    it('is served on the deprecated bare `/v1` alias too (ADR-0011)', async () => {
        const response = await fetch(`${booted.baseUrl}/v1/recipes/nutrition-batch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipeIds: [firstRecipeId] }),
        });

        expect(response.status).toBe(200);
    });
});
