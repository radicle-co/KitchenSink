/**
 * `GET /api/v1/recipes/{id}` for a saved line the review gate ABSTAINED on (owner ruling 2026-10-25, ADR-0071 review
 * item 10), over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real
 * `AppModule`, every DAL the detail read touches replaced by a double, and food faked at the network.
 *
 * What it proves beyond the unit tier: the abstention reaches the published wire as the AMBIGUOUS badge (the
 * ambiguity-review surface) through the assembler, the response mapper and the contract; a QUANTITY-only abstention
 * does not; and a verdict that never asked identity is not read as an identity abstention.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { LineVerdictRow } from '../../../src/recipes/dal/lineVerifications.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const VIEWER = '01JABSTENTIONVIEWER0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000b1';
const AT = new Date('2026-10-25T00:00:00.000Z');
const ARM: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000d001',
    foodId: 'R-milk',
    foodOwnerId: null,
    createdAt: AT,
};

let food: FoodFake;
let booted: BootedServiceApp;
/** The verdict the verdict double answers for every key the read asks about. */
let verdict: LineVerdictRow | undefined;

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-milk', { name: 'Milk, whole', status: 'RESOLVED', caloriesPer100g: 61 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    findById: async (id: string) =>
                        id === RECIPE_ID
                            ? {
                                  recipe: makeRecipeRow({ id: RECIPE_ID, ownerId: VIEWER, servings: 1 }),
                                  steps: [makeRecipeStepRow({ recipeId: RECIPE_ID })],
                                  ingredients: [
                                      makeIngredientLineRow({
                                          id: '00000000-0000-4000-8000-00000000e001',
                                          recipeId: RECIPE_ID,
                                          foodLookupId: ARM.lookupId,
                                          quantity: '1',
                                          unit: 'cup',
                                          sourceLine: '1 cup milk',
                                      }),
                                  ],
                              }
                            : undefined,
                },
            },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: {
                    findBandsByKeys: async (keys: readonly string[]) =>
                        new Map(verdict === undefined ? [] : keys.map((key) => [key, verdict])),
                    findExistingKeys: async () => new Set(),
                },
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

/** The detail read's one line status, through the published contract. */
async function lineStatus(): Promise<string | undefined> {
    const response = await asPrincipal(VIEWER, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}`, { headers: { authorization: bearerFor(VIEWER) } }),
    );

    expect(response.status).toBe(200);

    return recipeDetailSchema.parse(await response.json()).ingredients[0]?.resolutionStatus;
}

describe('GET /api/v1/recipes/:id — a saved line the gate abstained on (integration)', () => {
    it('⛔ badges the line AMBIGUOUS when the gate abstained on its IDENTITY', async () => {
        verdict = {
            band: 'inconclusive',
            certainty: 'high',
            identityVerdict: 'abstain',
            aspects: ['identity', 'quantity'],
        };

        expect(await lineStatus()).toBe('AMBIGUOUS');
    });

    it('keeps the catalog status when only the QUANTITY was in doubt (identity agreed)', async () => {
        verdict = {
            band: 'inconclusive',
            certainty: 'high',
            identityVerdict: 'agree',
            aspects: ['identity', 'quantity'],
        };

        expect(await lineStatus()).toBe('RESOLVED');
    });

    it('⛔ does not badge an UNREADABLE model answer — a formatting failure is not an identity abstention', async () => {
        // The worker stores an unreadable answer as abstain, low certainty, band inconclusive, with no itemization.
        verdict = {
            band: 'inconclusive',
            certainty: 'low',
            identityVerdict: null,
            aspects: ['identity', 'quantity'],
        };

        expect(await lineStatus()).toBe('RESOLVED');
    });

    it('⛔ does not read a verdict that never asked identity as an identity abstention', async () => {
        // The itemized identity answer says `abstain`, but the gate asked QUANTITY only: that answer is about nothing.
        // Removing the aspects guard from the classifier makes this line AMBIGUOUS, and this case fail.
        verdict = {
            band: 'inconclusive',
            certainty: 'high',
            identityVerdict: 'abstain',
            aspects: ['quantity'],
        };

        expect(await lineStatus()).toBe('RESOLVED');
    });

    it('keeps the passive NEEDS_REVIEW badge for a contradiction the model did not itemize (the old population)', async () => {
        verdict = { band: 'contradicted', certainty: 'high', identityVerdict: null, aspects: ['identity', 'quantity'] };

        expect(await lineStatus()).toBe('NEEDS_REVIEW');
    });

    it('keeps NEEDS_REVIEW, not the re-pick, for an identity disagreement short of high certainty', async () => {
        verdict = {
            band: 'contradicted',
            certainty: 'medium',
            identityVerdict: 'disagree',
            aspects: ['identity', 'quantity'],
        };

        expect(await lineStatus()).toBe('NEEDS_REVIEW');
    });
});
