/**
 * The save path's verification producer over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule`, the DALs and the verification queue doubled, food faked at
 * the network. Two rules from ADR-0071:
 *
 *  1. **A verdict already on record is not paid for again.** Before it enqueues, the producer reads
 *     `recipe_ingredient_verifications` by the line's verdict key. A pasted line whose proposal the gate already judged
 *     is the case this is for.
 *  2. **The producer reads no provenance off the SHARED binding.** It declares `unattributed` for every line, so the
 *     gate checks identity whatever another cook's add once recorded on that binding.
 *
 * Whether the verdict table really answers by key is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import type { VerifyIngredientLineMessage } from '@kitchensink/recipe-core/resolution/verification-message';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import { sha256Hex } from '../../../src/common/sha256.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { RecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { VERIFICATION_QUEUE } from '../../../src/recipes/verification.queue.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JVERIFYDEDUPCOOK00000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000d1';
const AT = new Date('2026-10-25T00:00:00.000Z');
const SOURCE_LINE = '1 cup whole milk';
const MILK: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000d101',
    foodId: 'R-milk',
    foodOwnerId: null,
    createdAt: AT,
};

/** The verdict key the line's judgement lives under, derived the way production derives it. */
const MILK_KEY = verificationKey(
    {
        sourceLine: SOURCE_LINE,
        foodRefId: 'R-milk',
        quantityLow: 1,
        quantityHigh: null,
        unit: 'cup',
        statedMeasure: null,
    },
    sha256Hex,
);

/** The verdict keys the doubled table holds. Each test sets it. */
let onRecord = new Set<string>();
const sent: VerifyIngredientLineMessage[][] = [];

function aggregateOf(): RecipeAggregate {
    const recipe = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft' });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [
            makeIngredientLineRow({
                recipeId: recipe.id,
                foodLookupId: MILK.lookupId,
                quantity: '1',
                unit: 'cup',
                sourceLine: SOURCE_LINE,
            }),
        ],
    };
}

let food: FoodFake;
let booted: BootedServiceApp;

/** Save the recipe as the cook. @sideEffect One HTTP request. */
async function save(): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify({
                title: 'Custard',
                status: 'draft',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [
                    {
                        ingredientId: MILK.lookupId,
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'cup',
                        sourceLine: SOURCE_LINE,
                    },
                ],
                steps: [{ instruction: 'Whisk.' }],
            }),
        }),
    );
}

const findExistingKeys = vi.fn(async (keys: readonly string[]) => new Set(keys.filter((key) => onRecord.has(key))));

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-milk', { name: 'Milk, whole', status: 'RESOLVED', caloriesPer100g: 61 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    create: vi.fn(async () => aggregateOf()),
                    findById: async () => aggregateOf(),
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ __tx: true }),
                },
            },
            {
                provide: VERSIONS_DAL,
                useValue: {
                    createSnapshot: vi.fn(async () => ({ id: 'v', snapshot: {}, createdAt: AT })),
                    findVersionsBeyondRetention: async () => [],
                },
            },
            {
                provide: VERIFICATION_QUEUE,
                useValue: {
                    enqueue: vi.fn(async (messages: readonly VerifyIngredientLineMessage[]) => {
                        sent.push([...messages]);
                    }),
                },
            },
            { provide: PendingArchivesDal, useValue: { enqueueMany: async () => undefined } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys },
            },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ids.includes(MILK.lookupId) ? [[MILK.lookupId, MILK]] : []),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
        ],
    });
});

afterEach(() => {
    onRecord = new Set();
    sent.length = 0;
    findExistingKeys.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/recipes — the verification producer (integration)', () => {
    it('⛔ sends NO message for a line whose verdict is already on record', async () => {
        onRecord = new Set([MILK_KEY]);

        const response = await save();

        expect(response.status).toBe(201);
        expect(findExistingKeys).toHaveBeenCalledWith([MILK_KEY]);
        expect(sent).toEqual([]);
    });

    it('sends one UNATTRIBUTED message when no verdict is on record', async () => {
        const response = await save();

        expect(response.status).toBe(201);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.[0]).toMatchObject({
            origin: { kind: 'recipe', recipeId: RECIPE_ID },
            foodId: 'R-milk',
            evidenceKind: 'unattributed',
            shortlist: [],
        });
    });
});
