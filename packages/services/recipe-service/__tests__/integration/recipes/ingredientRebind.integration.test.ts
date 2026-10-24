/**
 * `POST /api/v1/recipes/{id}/ingredients/{position}/rebind` when the target is the binding the line already holds,
 * over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule`
 * with every DAL the command and the detail read touch replaced by a double, and food faked at the network
 * (`tests/support/foodFake.ts`), so the real food client serializes, forwards the bearer and parses.
 *
 * It pins the version contract an editor that adopts the command's answer relies on (ADR-0045): a stale
 * `expectedVersion` meets the enriched 409 every recipe write gives, and a current one is answered with the version
 * it sent — even when another write commits while food is asked. The real SQL is the LOCAL e2e tier's
 * (`tests/e2e/ingredientRebindNoOp.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { versionConflictDetailsSchema } from '@kitchensink/recipe-core';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

import {
    makeIngredientLineRow,
    makeRecipeRow,
    makeRecipeStepRow,
    makeVersionRow,
} from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { BoundArm } from '../../../src/database/schema/foodLookupArm.js';
import { makeRootArm } from '../../../src/ingredients/__fixtures__/foodLookups.fixture.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import { ResolutionMappingsDal } from '../../../src/ingredients/resolution/resolutionMappings.dal.js';
import type { RecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JREBINDNOOPCOOK000000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000d1';
const BRISKET = makeRootArm({ lookupId: '00000000-0000-4000-8000-00000000d101', foodId: 'R-brisket' });
const SHOULDER = makeRootArm({ lookupId: '00000000-0000-4000-8000-00000000d102', foodId: 'R-shoulder' });

let food: FoodFake;
let booted: BootedServiceApp;
/** The version the recipe double holds. A test moves it to stand for another writer's commit. */
let storedVersion = 3;
/** Runs when the command binds its target: after the version check, before the answer. */
let onBind: () => void = () => undefined;

/** The recipe at `version`: line 0 holds the brisket and carries an imported phrase, line 1 the shoulder. */
function aggregateAt(version: number): RecipeAggregate {
    const recipe = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, currentVersion: version, servings: 2 });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: RECIPE_ID })],
        ingredients: [BRISKET, SHOULDER].map((arm, index) =>
            makeIngredientLineRow({
                id: `00000000-0000-4000-8000-00000000d20${String(index)}`,
                recipeId: RECIPE_ID,
                foodLookupId: arm.lookupId,
                quantity: '500',
                unit: 'g',
                sourcePhrase: index === 0 ? 'beef brisket' : null,
                sortOrder: index,
            }),
        ),
    };
}

const findById = vi.fn(async (id: string) => (id === RECIPE_ID ? aggregateAt(storedVersion) : undefined));
const readConflict = vi.fn(async (_id: string, expectedVersion: number) => ({
    current: aggregateAt(storedVersion),
    baseVersion: makeVersionRow({
        recipeId: RECIPE_ID,
        versionNumber: expectedVersion,
        snapshot: {
            version: expectedVersion,
            title: 'Brisket',
            description: '',
            steps: [],
            ingredients: [],
            servings: 2,
            prepTimeMinutes: 0,
            cookTimeMinutes: 0,
        },
    }),
}));
/** Every recipe write opens this transaction, so a write fails the request and the spy records it. */
const transaction = vi.fn(async (): Promise<never> => {
    throw new Error('a rebind that changes nothing must not write the recipe');
});
/** Every correction opens this transaction. */
const runInTransaction = vi.fn(async (): Promise<never> => {
    throw new Error('a rebind that changes nothing must not record a correction');
});
const findOrCreateBound = vi.fn(async (): Promise<BoundArm> => {
    onBind();

    return BRISKET;
});
const deleteIfOrphanedFailure = vi.fn(async () => false);

/**
 * Rebind line 0 to the brisket it already holds, as the cook, forwarding the cook's bearer to food.
 *
 * @sideEffect One HTTP request under the dev-bypass identity.
 */
async function rebindToSameFood(expectedVersion: number): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes/${RECIPE_ID}/ingredients/0/rebind`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify({ expectedVersion, target: { kind: 'catalogFood', foodId: 'R-brisket' } }),
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-brisket', { name: 'Beef brisket', status: 'RESOLVED', caloriesPer100g: 170 });
    food.foods.set('R-shoulder', { name: 'Pork shoulder', status: 'RESOLVED', caloriesPer100g: 240 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: RECIPES_DAL, useValue: { findById, readConflict, transaction } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: { findBandsByKeys: async () => new Map() } },
            { provide: IngredientResolutionsDal, useValue: { latestResolutionsByLookupIds: async () => new Map() } },
            { provide: ResolutionMappingsDal, useValue: { runInTransaction } },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findOrCreateBound,
                    deleteIfOrphanedFailure,
                    findByIds: async (ids: readonly string[]) =>
                        new Map(
                            [BRISKET, SHOULDER]
                                .filter((arm) => ids.includes(arm.lookupId))
                                .map((arm) => [arm.lookupId, arm]),
                        ),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    storedVersion = 3;
    onBind = () => undefined;
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/recipes/{id}/ingredients/{position}/rebind — a no-op rebind (integration)', () => {
    it('answers a current no-op with the version sent, in the PUBLISHED shape, writing nothing', async () => {
        const res = await rebindToSameFood(3);
        const detail = recipeDetailSchema.parse(await res.json());

        expect(res.status).toBe(200);
        expect(detail.currentVersion).toBe(3);
        expect(detail.ingredients.map((line) => line.ingredientId)).toStrictEqual([
            BRISKET.lookupId,
            SHOULDER.lookupId,
        ]);
        expect(findOrCreateBound).toHaveBeenCalledTimes(1);
        expect(transaction).not.toHaveBeenCalled();
        expect(runInTransaction).not.toHaveBeenCalled();
        expect(deleteIfOrphanedFailure).not.toHaveBeenCalled();
    });

    it('⛔ answers the version it sent when another write commits while food is asked', async () => {
        onBind = () => {
            storedVersion = 4;
        };

        const res = await rebindToSameFood(3);
        const detail = recipeDetailSchema.parse(await res.json());

        expect(storedVersion).toBe(4);
        expect(res.status).toBe(200);
        expect(detail.currentVersion).toBe(3);
        expect(transaction).not.toHaveBeenCalled();
        expect(runInTransaction).not.toHaveBeenCalled();
    });

    it('⛔ refuses a stale no-op with the enriched 409 and both sides, before asking food or writing', async () => {
        storedVersion = 4;

        const res = await rebindToSameFood(3);
        const body = (await res.json()) as { code?: string; details?: unknown };
        const details = versionConflictDetailsSchema.parse(body.details);

        expect(res.status).toBe(409);
        expect(body.code).toBe('VERSION_CONFLICT');
        expect({
            currentVersion: details.currentVersion,
            conflictingVersion: details.conflictingVersion,
            server: details.server.versionNumber,
            base: details.base?.versionNumber,
        }).toStrictEqual({ currentVersion: 4, conflictingVersion: 3, server: 4, base: 3 });
        expect(findOrCreateBound).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
        expect(runInTransaction).not.toHaveBeenCalled();
    });
});
