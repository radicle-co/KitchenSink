/**
 * The byline a write stores, over the REAL HTTP pipeline with the DALs MOCKED (plan 2026-10-15-010 D8;
 * `docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` — routing, the zod pipe, the auth middleware and the
 * services — with the `author_handles` read model replaced by a double.
 *
 * It pins what the unit tier cannot: that `RecipesModule` wires its OWN `AuthorHandlesDal`, that the write reads it
 * inside the write's transaction, and that both halves of the byline reach the recipe row and its first version.
 * The read-model lock itself (`FOR SHARE`) is a property of Postgres and is the LOCAL e2e tier's.
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import { IngredientResolutionsDal } from '../../../src/ingredients/resolution/ingredientResolutions.dal.js';
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

const COOK = '01JBYLINESEEDINGCOOK0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000b1';
const NOW = new Date('2026-10-15T00:00:00.000Z');

const create = vi.fn(async (input: { readonly status?: string }) => {
    const recipe = makeRecipeRow({
        id: RECIPE_ID,
        ownerId: COOK,
        status: input.status ?? 'published',
        firstPublishedAt: NOW,
    });

    return { recipe, steps: [makeRecipeStepRow({ recipeId: RECIPE_ID })], ingredients: [] };
});
const createSnapshot = vi.fn(async (input: { readonly recipeId: string; readonly versionNumber: number }) => ({
    id: 'version-1',
    ...input,
    snapshot: {},
    baseVersion: null,
    s3Key: null,
    createdBy: COOK,
    changeSummary: null,
    editorDisplayName: null,
    editorUsername: null,
    createdAt: NOW,
}));
const findByline = vi.fn();
const transactionHandle = { __tx: true };

let food: FoodFake;
let booted: BootedServiceApp;

beforeAll(async () => {
    food = await startFoodFake();
    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    create,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(transactionHandle),
                },
            },
            { provide: VERSIONS_DAL, useValue: { createSnapshot, findVersionsBeyondRetention: async () => [] } },
            { provide: PendingArchivesDal, useValue: { enqueueMany: async () => undefined } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined } },
            { provide: RECIPE_LINE_VERIFICATIONS_DAL, useValue: { findBandsByKeys: async () => new Map() } },
            { provide: IngredientResolutionsDal, useValue: { latestResolutionsByLookupIds: async () => new Map() } },
            { provide: FoodLookupsDal, useValue: { findByIds: async () => new Map() } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline } },
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

async function post(): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: bearerFor(COOK) },
            body: JSON.stringify({
                title: 'Brisket',
                status: 'draft',
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [],
                steps: [],
            }),
        }),
    );
}

describe('POST /api/v1/recipes — the byline it stores', () => {
    it('stores the READ MODEL’s display name and username, read inside the write’s transaction', async () => {
        findByline.mockResolvedValue({ displayName: 'Chef Ada', username: 'ada_cooks' });

        const response = await post();

        expect(response.status).toBe(201);
        expect(findByline).toHaveBeenCalledWith(COOK, transactionHandle);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({ authorDisplayName: 'Chef Ada', authorUsername: 'ada_cooks' }),
            transactionHandle,
        );
    });

    it('stores NO byline columns for a cook neither the read model nor the token knows', async () => {
        findByline.mockResolvedValue(undefined);

        const response = await post();
        const input = create.mock.calls[0]?.[0] as Record<string, unknown>;

        expect(response.status).toBe(201);
        expect(input).not.toHaveProperty('authorUsername');
        expect(input).not.toHaveProperty('authorDisplayName');
    });
});
