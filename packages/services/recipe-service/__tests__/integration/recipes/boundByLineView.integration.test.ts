/**
 * `GET /api/v1/recipes/{id}` and who bound each line (`boundBy`, ADR-0072 §5) over the REAL HTTP pipeline, its dependencies
 * MOCKED (`docs/CODING_STANDARDS.md` §7.1a), parsed with the PUBLISHED contract (`@kitchensink/schema-recipe`).
 *
 * What the unit tier cannot prove: that the stored origin travels through the response mapper, the DTO and the zod the
 * typed client parses with, and survives that parse. The recipe-core line view is NOT strict, so a field its schema lacked
 * would be silently STRIPPED by the client; this fails if `boundBy` is ever dropped from the published schema.
 *
 * | Case | Pinned here |
 * | --- | --- |
 * | each of the six origins | published verbatim |
 * | no recorded origin (NULL) | the key is absent, never `null` |
 * | `import_line_id` | provenance only: never on the wire |
 */
import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const VIEWER = '01JBOUNDBYLINEVIEWER000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000b1';
const IMPORT_LINE = '00000000-0000-4000-8000-0000000000e1';
const AT = new Date('2026-10-26T00:00:00.000Z');
const ARM: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000b101',
    foodId: 'R-flour',
    foodOwnerId: null,
    createdAt: AT,
};
const ORIGINS = ['exact', 'curated', 'review', 'default', 'autoBest', 'cook'] as const;

let food: FoodFake;
let booted: BootedServiceApp;

/** One line per origin, then one with no recorded origin, then one carrying an import link. */
function aggregate() {
    const lineOf = (index: number, columns: { boundBy: string | null; importLineId?: string | null }) =>
        makeIngredientLineRow({
            id: `00000000-0000-4000-8000-00000000c10${String(index)}`,
            recipeId: RECIPE_ID,
            foodLookupId: ARM.lookupId,
            sortOrder: index,
            ...columns,
        });

    return {
        recipe: makeRecipeRow({ id: RECIPE_ID, ownerId: VIEWER, servings: 1 }),
        steps: [makeRecipeStepRow({ recipeId: RECIPE_ID })],
        ingredients: [
            ...ORIGINS.map((boundBy, index) => lineOf(index, { boundBy })),
            lineOf(ORIGINS.length, { boundBy: null }),
            lineOf(ORIGINS.length + 1, { boundBy: 'cook', importLineId: IMPORT_LINE }),
        ],
    };
}

async function readRecipe(): Promise<Response> {
    return asPrincipal(VIEWER, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}`, { headers: { authorization: bearerFor(VIEWER) } }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-flour', { name: 'Flour', status: 'RESOLVED', caloriesPer100g: 364 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: { findById: async (id: string) => (id === RECIPE_ID ? aggregate() : undefined) },
            },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            {
                provide: FoodLookupsDal,
                useValue: { findByIds: async () => new Map([[ARM.lookupId, ARM]]) },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/recipes/{id} — boundBy (integration: real pipeline, mocked dependencies)', () => {
    it("⛔ publishes each stored origin, and it survives the typed client's parse", async () => {
        const res = await readRecipe();
        const detail = recipeDetailSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(detail.ingredients.slice(0, ORIGINS.length).map((line) => line.boundBy)).toStrictEqual([...ORIGINS]);
    });

    it('omits boundBy for a line with no recorded origin, never publishing null', async () => {
        const raw = (await (await readRecipe()).json()) as { ingredients: Record<string, unknown>[] };
        const noOrigin = raw.ingredients[ORIGINS.length];

        expect(noOrigin).toBeDefined();
        expect('boundBy' in (noOrigin ?? {})).toBe(false);
    });

    it('never publishes the import link: provenance is not part of the recipe a cook reads', async () => {
        const raw = (await (await readRecipe()).json()) as { ingredients: Record<string, unknown>[] };

        for (const line of raw.ingredients) {
            expect(line).not.toHaveProperty('importLineId');
            expect(line).not.toHaveProperty('import_line_id');
        }

        expect(raw.ingredients.at(-1)).toMatchObject({ boundBy: 'cook' });
    });
});
