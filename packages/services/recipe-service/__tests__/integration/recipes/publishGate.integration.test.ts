/**
 * The publish gate over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real
 * `AppModule` — routing, the zod pipe (which canonicalises the cuisine), the auth middleware, `RecipesService` and its
 * publish policy, the exception filter — with the DALs replaced by doubles and food faked at the network.
 *
 * It pins what the unit tier cannot: that a refusal reaches the wire as the published `PUBLISH_REQUIREMENTS_UNMET`
 * envelope (parsed here with the service's own typed error schema), that the stored cuisine is the CANONICAL one the
 * wire parse produced, and that the PATCH clear sentinel travels from the body to the DAL.
 *
 * Whether the real database stores and clears the value is the LOCAL e2e tier's (`tests/e2e/publishGate.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
import type { RecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JPUBLISHGATECOOK00000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000f1';
const AT = new Date('2026-10-01T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000f101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};

/** The recipe the double holds. Each test sets it. */
let stored: RecipeRow;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const create = vi.fn(async (input: { readonly status: string; readonly cuisine?: string }) => {
    stored = makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        status: input.status,
        cuisine: input.cuisine ?? null,
        firstPublishedAt: input.status === 'published' ? AT : null,
    });

    return aggregateOf(stored);
});
const update = vi.fn(
    async (
        _id: string,
        patch: { readonly expectedVersion: number; readonly status?: string; readonly cuisine?: string | null },
    ) => {
        stored = {
            ...stored,
            ...(patch.status === undefined ? {} : { status: patch.status }),
            ...(patch.cuisine === undefined ? {} : { cuisine: patch.cuisine }),
            currentVersion: stored.currentVersion + 1,
        };

        return aggregateOf(stored);
    },
);

let food: FoodFake;
let booted: BootedServiceApp;

async function call(method: string, path: string, body: unknown): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify(body),
        }),
    );
}

/** A create body with a line and a step; `status` absent, so it publishes. */
const PUBLISH_BODY = {
    title: 'Pesto',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 0,
    totalTimeMinutes: 5,
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Blend.' }],
};

/** The typed refusal a response carries, or a failure naming what came back instead. */
async function refusalOf(response: Response): Promise<unknown> {
    const parsed = recipeApiErrorSchema.parse(await response.json());

    return { status: response.status, code: parsed.code, details: 'details' in parsed ? parsed.details : undefined };
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-basil', { name: 'Basil', status: 'RESOLVED', caloriesPer100g: 23 });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    create,
                    update,
                    findById: async (id: string) => (id === RECIPE_ID ? aggregateOf(stored) : undefined),
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
            { provide: PendingArchivesDal, useValue: { enqueueMany: async () => undefined } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: { findBandsByKeys: async () => new Map() } },
            { provide: IngredientResolutionsDal, useValue: { latestResolutionsByLookupIds: async () => new Map() } },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ids.includes(BASIL.lookupId) ? [[BASIL.lookupId, BASIL]] : []),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('POST /api/v1/recipes — a cuisine is required to publish (owner rulings 2026-10-13)', () => {
    it('answers 400 PUBLISH_REQUIREMENTS_UNMET naming the cuisine, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', PUBLISH_BODY);

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PUBLISH_REQUIREMENTS_UNMET',
            details: { missing: ['cuisine'] },
        });
        expect(create).not.toHaveBeenCalled();
    });

    it('names every gap, in page order, for a body that publishes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...PUBLISH_BODY,
            status: 'published',
            ingredients: [],
            steps: [],
        });

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PUBLISH_REQUIREMENTS_UNMET',
            details: { missing: ['cuisine', 'ingredients', 'steps'] },
        });
    });

    it('stores the CANONICAL cuisine the wire parse produced, published explicitly', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLISH_BODY, cuisine: '  szechuan ' });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ cuisine: 'Sichuan', status: 'published' }),
            expect.anything(),
        );
    });

    it('saves a draft with no cuisine', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...PUBLISH_BODY, status: 'draft' });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }), expect.anything());
    });
});

describe('PATCH /api/v1/recipes/{id} — the cuisine can be cleared, but not from a published recipe', () => {
    it('refuses clearing the cuisine of a published recipe, writing nothing', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'published', cuisine: 'Italian' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, cuisine: null });

        expect(await refusalOf(response)).toEqual({
            status: 400,
            code: 'PUBLISH_REQUIREMENTS_UNMET',
            details: { missing: ['cuisine'] },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('clears the cuisine of a draft: the `null` reaches the DAL', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', cuisine: 'Italian' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, cuisine: null });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(RECIPE_ID, expect.objectContaining({ cuisine: null }), expect.anything());
    });

    it('lets a stored public-domain import stay published with no cuisine (the curator exemption)', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            sourceType: 'imported_public',
            cuisine: null,
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Kugel' });

        expect(response.status).toBe(200);
    });
});
