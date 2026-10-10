/**
 * `GET /api/v1/recipes/{id}` with variant-bound lines (curated plan U9; R20, R21, R25, R29) over the REAL HTTP
 * pipeline, its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` with every DAL the detail
 * read touches replaced by a double, and food faked at the network (`tests/support/foodFake.ts`), so the real food
 * client serializes, forwards the bearer and parses food's published shapes.
 *
 * It proves what the unit tier cannot: that the line view's variant reaches the published wire through the response
 * mapper, the DTO and the contract, and that a food outage leaves the recipe readable.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | R20, R25 | a variant line carries its root's name, the live root id and the variant's parts |
 * | U14's `Add details` | a root line carries `hasVariants` from food's batch |
 * | R21 | the variant line's nutrition is the variant's own, never its root's |
 * | R29 (owner, 2026-10-01) | a line bound to an entry the seed retired with no successor keeps its name and numbers |
 * | KTD-3b | food down: the recipe answers 200, the line is unreachable, nothing food did not say is invented |
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const VIEWER = '01JVARIANTLINEVIEWER0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000a1';
const AT = new Date('2026-10-01T00:00:00.000Z');

/** One binding per arm the read exercises. */
const ARMS: readonly FoodLookupArm[] = [
    {
        kind: 'root',
        lookupId: '00000000-0000-4000-8000-00000000b001',
        foodId: 'R-brisket',
        foodOwnerId: null,
        createdAt: AT,
    },
    { kind: 'variant', lookupId: '00000000-0000-4000-8000-00000000b002', foodVariantId: 'V-flat', createdAt: AT },
    { kind: 'variant', lookupId: '00000000-0000-4000-8000-00000000b003', foodVariantId: 'V-gone', createdAt: AT },
];

const FLAT_PARTS = [{ attribute: 'cut', text: 'flat' }];

let food: FoodFake;
let booted: BootedServiceApp;

/** The recipe the RECIPES_DAL double holds: one 100 g line per binding, over 1 serving. */
function aggregate() {
    const recipe = makeRecipeRow({ id: RECIPE_ID, ownerId: VIEWER, servings: 1 });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: RECIPE_ID })],
        ingredients: ARMS.map((arm, index) =>
            makeIngredientLineRow({
                id: `00000000-0000-4000-8000-00000000c00${String(index)}`,
                recipeId: RECIPE_ID,
                foodLookupId: arm.lookupId,
                quantity: '100',
                unit: 'g',
                sortOrder: index,
            }),
        ),
    };
}

/**
 * Read the recipe as the viewer, forwarding the viewer's bearer to food.
 *
 * @sideEffect One HTTP request under the dev-bypass identity.
 */
async function readRecipe(): Promise<Response> {
    return asPrincipal(VIEWER, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}`, { headers: { authorization: bearerFor(VIEWER) } }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-brisket', { name: 'Beef brisket', status: 'RESOLVED', caloriesPer100g: 170 });
    food.foods.set('V-flat', {
        name: null,
        status: 'RESOLVED',
        caloriesPer100g: 155,
        variantOf: { rootId: 'R-brisket', parts: FLAT_PARTS },
    });
    // A cut the seed removed with no successor: retired, no forward — it still answers (R29).
    food.foods.set('V-gone', {
        name: null,
        status: 'RESOLVED',
        caloriesPer100g: 260,
        retired: true,
        variantOf: { rootId: 'R-brisket', parts: [{ attribute: 'cut', text: 'point' }] },
    });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: { findById: async (id: string) => (id === RECIPE_ID ? aggregate() : undefined) },
            },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: { findBandsByKeys: async () => new Map() } },
            { provide: IngredientResolutionsDal, useValue: { latestResolutionsByLookupIds: async () => new Map() } },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ARMS.filter((arm) => ids.includes(arm.lookupId)).map((arm) => [arm.lookupId, arm])),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    food.down = false;
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/recipes/{id} — variant lines (integration: real pipeline, mocked dependencies)', () => {
    it('carries each line’s live root, its variant and hasVariants in the PUBLISHED shape', async () => {
        const res = await readRecipe();
        const detail = recipeDetailSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(
            detail.ingredients.map(({ name, foodId, variant, hasVariants }) => ({
                name,
                foodId,
                variant,
                hasVariants,
            })),
        ).toStrictEqual([
            // The root line: its root has a live variant (the flat cut), so the menu offers `Add details`.
            { name: 'Beef brisket', foodId: 'R-brisket', variant: undefined, hasVariants: true },
            {
                name: 'Beef brisket',
                foodId: 'R-brisket',
                variant: { id: 'V-flat', parts: FLAT_PARTS },
                hasVariants: undefined,
            },
            // ⛔ R29: the retired cut keeps its root's name and its own parts.
            {
                name: 'Beef brisket',
                foodId: 'R-brisket',
                variant: { id: 'V-gone', parts: [{ attribute: 'cut', text: 'point' }] },
                hasVariants: undefined,
            },
        ]);
    });

    it('⛔ R21/R29: each line counts its OWN food’s numbers — root 170, flat 155, the retired cut 260', async () => {
        const detail = recipeDetailSchema.parse(await (await readRecipe()).json());

        // 100 g of each over one serving.
        expect(detail.nutrition?.calories).toBe(170 + 155 + 260);
        expect(detail.nutrition?.isComplete).toBe(true);
    });

    it('⛔ food down: the recipe still answers 200, every line FOOD_UNREACHABLE, nothing food did not say', async () => {
        food.down = true;

        const res = await readRecipe();
        const detail = recipeDetailSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(detail.ingredients.map((line) => line.resolutionStatus)).toStrictEqual([
            'FOOD_UNREACHABLE',
            'FOOD_UNREACHABLE',
            'FOOD_UNREACHABLE',
        ]);
        // The root line keeps the only root it can know. Its `hasVariants` is food DATA the earlier reads cached, so it
        // is served stale with the numbers (KTD-3b); a cold cache reads `false`, which the unit tier pins.
        expect(detail.ingredients[0]).toMatchObject({ foodId: 'R-brisket', hasVariants: true });
        expect(detail.nutrition?.freshness).toBe('stale');

        for (const line of detail.ingredients.slice(1)) {
            expect(line.foodId).toBeUndefined();
            expect(line.variant).toBeUndefined();
            expect(line.hasVariants).toBeUndefined();
        }
    });
});
