/**
 * ADR-0058 over the REAL HTTP pipeline with its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real
 * `AppModule` — routing, the zod pipe, the auth middleware, the services and the version module — with the DALs
 * replaced by doubles, and food faked at the network.
 *
 * It pins what the unit tier cannot: that `POST`/`PATCH` bodies reach the one convergence point
 * (`recordSnapshotIn`) through the assembled modules, and that the version module's writes — the version row AND the
 * retention pass — are both skipped for a never-published draft and both made for a published one.
 *
 * The recipe double plays the database's part: it answers each write with the row the 0053 trigger would produce
 * (`first_published_at` set on the first publish, kept after). Whether the real trigger does that is the LOCAL e2e
 * tier's (`tests/e2e/draftVersions.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

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

const COOK = '01JDRAFTVERSIONINGCOOK00001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000e1';
const PUBLISHED_AT = new Date('2026-10-01T00:00:00.000Z');
const BRISKET: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000e101',
    foodId: 'R-brisket',
    foodOwnerId: null,
    createdAt: PUBLISHED_AT,
};

/** The recipe the double holds, as the database would after each write. */
let stored: RecipeRow;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [
            makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BRISKET.lookupId, quantity: '1', unit: 'g' }),
        ],
    };
}

/** The 0053 trigger's rule, played by the double: set on the first publish, never cleared. */
function afterWrite(previous: RecipeRow | undefined, status: string): Date | null {
    return previous?.firstPublishedAt ?? (status === 'published' ? PUBLISHED_AT : null);
}

const create = vi.fn(async (input: { readonly status?: string }) => {
    const status = input.status ?? 'published';

    stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status, firstPublishedAt: afterWrite(undefined, status) });

    return aggregateOf(stored);
});
const update = vi.fn(async (_id: string, patch: { readonly expectedVersion: number; readonly status?: string }) => {
    if (patch.expectedVersion !== stored.currentVersion) {
        return undefined;
    }

    const status = patch.status ?? stored.status;

    stored = {
        ...stored,
        status,
        currentVersion: stored.currentVersion + 1,
        firstPublishedAt: afterWrite(stored, status),
    };

    return aggregateOf(stored);
});
const createSnapshot = vi.fn(async (input: { readonly recipeId: string; readonly versionNumber: number }) => ({
    id: `version-${String(input.versionNumber)}`,
    ...input,
    snapshot: {},
    baseVersion: null,
    s3Key: null,
    createdBy: COOK,
    changeSummary: null,
    editorHandle: null,
    createdAt: PUBLISHED_AT,
}));
const findVersionsBeyondRetention = vi.fn(async () => []);
const enqueueMany = vi.fn(async () => undefined);

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

const DRAFT_BODY = {
    title: 'Brisket',
    status: 'draft',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [],
    steps: [],
};

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-brisket', { name: 'Beef brisket', status: 'RESOLVED', caloriesPer100g: 170 });

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
            { provide: VERSIONS_DAL, useValue: { createSnapshot, findVersionsBeyondRetention } },
            { provide: PendingArchivesDal, useValue: { enqueueMany } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: { findBandsByKeys: async () => new Map() } },
            { provide: IngredientResolutionsDal, useValue: { latestResolutionsByLookupIds: async () => new Map() } },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ids.includes(BRISKET.lookupId) ? [[BRISKET.lookupId, BRISKET]] : []),
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

describe('a never-published draft records no version (ADR-0058, integration)', () => {
    it('a draft POST and its PATCHes skip both the version row and the retention pass', async () => {
        const created = await call('POST', '/api/v1/recipes', DRAFT_BODY);
        const saved = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Brisket!' });

        expect(created.status).toBe(201);
        expect(recipeDetailSchema.parse(await saved.json()).currentVersion).toBe(2);
        expect(create).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(createSnapshot).not.toHaveBeenCalled();
        expect(findVersionsBeyondRetention).not.toHaveBeenCalled();
        expect(enqueueMany).not.toHaveBeenCalled();
    });

    it('⛔ the publishing PATCH records the first version at the number it produced, then every save versions', async () => {
        await call('POST', '/api/v1/recipes', DRAFT_BODY);
        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Brisket!' });

        const published = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 2,
            status: 'published',
        });

        expect(published.status).toBe(200);
        expect(createSnapshot).toHaveBeenCalledTimes(1);
        expect(createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: RECIPE_ID, versionNumber: 3 }),
            { __tx: true },
        );
        expect(findVersionsBeyondRetention).toHaveBeenCalledTimes(1);

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 3, status: 'draft' });
        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 4, title: 'Brisket, again' });

        expect(createSnapshot.mock.calls.map(([input]) => input.versionNumber)).toStrictEqual([3, 4, 5]);
    });

    it('a published POST records its first version, as before', async () => {
        const created = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            status: undefined,
            ingredients: [{ ingredientId: BRISKET.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'g' }],
            steps: [{ instruction: 'Cook.' }],
        });

        expect(created.status).toBe(201);
        expect(createSnapshot).toHaveBeenCalledTimes(1);
        expect(createSnapshot).toHaveBeenCalledWith(expect.objectContaining({ versionNumber: 1 }), { __tx: true });
    });
});
