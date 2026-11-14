/**
 * `sourceLine` is OWNER-ONLY (ADR-0082 §2, `transcriptionDisclosure.ts`) over the REAL HTTP pipeline, its dependencies
 * MOCKED (`docs/CODING_STANDARDS.md` §7.1a).
 *
 * The line a cook pasted or imported is verbatim copied text. The recipe's owner sees it ("You wrote: …"); no other
 * cook, list, search, collection or version snapshot does.
 *
 * ⛔ Every absence is asserted on the RAW response text, never after `recipeDetailSchema.parse`: that schema is not
 * strict, so parsing would strip a leaked key and hide the leak.
 *
 * | Case | Pinned here |
 * | --- | --- |
 * | owner GET | the line is present on the line that has one, absent on the one that has none |
 * | another cook GET of a public recipe | the text is nowhere in the body |
 * | a rating PUT (a reader's write) | the returned detail has no text |
 * | owner PATCH and set-visibility | the returned detail has the line |
 * | version list (a real snapshot) | no text, though the stored rows hold it |
 * | recipe list, search, collection read | no text |
 * | GET /recipes/{id} | `Cache-Control: private, no-store`, because the body differs by viewer |
 * | another cook clones it, then reads their clone | no text: they own the copy, not the words (ADR-0090) |
 * | the owner clones their own recipe | the text, because they wrote it |
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecipeVisibility } from '@kitchensink/recipe-core';
import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { recipeDetailSchema } from '@kitchensink/schema-recipe';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import type { RecipeVersionRow } from '../../../src/database/schema/index.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { IngredientLineInput } from '../../../src/recipes/dal/ingredientLines.dal.js';
import type { RecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import { recipeRowToDomain } from '../../../src/recipes/mappers/recipeRowToDomain.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { RATINGS_DAL } from '../../../src/ratings/ratings.service.js';
import { SEARCH_DAL } from '../../../src/search/search.service.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const OWNER = '01JSOURCELINEOWNER0000001';
const OTHER = '01JSOURCELINEOTHER0000001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000d1';
const COLLECTION_ID = '00000000-0000-4000-8000-0000000000d2';
const CLONE_ID = '00000000-0000-4000-8000-0000000000d3';
const AT = new Date('2026-11-01T00:00:00.000Z');
/** Distinctive on purpose: the assertions search the body for it. */
const SECRET = 'two cups of flour, sifted (MY GRANDMOTHERS CARD)';
const ARM: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000d101',
    foodId: 'R-flour',
    foodOwnerId: null,
    createdAt: AT,
};

/** A public, published recipe the owner transcribed: one line holds the pasted text, one holds none. */
let stored = makeRecipeRow({ id: RECIPE_ID, ownerId: OWNER, visibility: 'public', status: 'published' });
let versionRows: RecipeVersionRow[] = [];

function aggregateOf(recipe = stored): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [
            makeIngredientLineRow({
                id: '00000000-0000-4000-8000-00000000d201',
                recipeId: recipe.id,
                foodLookupId: ARM.lookupId,
                sortOrder: 0,
                sourceLine: SECRET,
                sourceLineTranscribedByOwner: true,
            }),
            makeIngredientLineRow({
                id: '00000000-0000-4000-8000-00000000d202',
                recipeId: recipe.id,
                foodLookupId: ARM.lookupId,
                sortOrder: 1,
                sourceLine: null,
            }),
        ],
    };
}

const update = vi.fn(
    async (
        _id: string,
        patch: { readonly expectedVersion: number; readonly ingredients?: readonly IngredientLineInput[] },
    ) => {
        if (patch.expectedVersion !== stored.currentVersion) {
            return undefined;
        }

        stored = { ...stored, currentVersion: stored.currentVersion + 1 };

        return aggregateOf();
    },
);
const setVisibility = vi.fn(async (_id: string, visibility: RecipeVisibility) => {
    stored = { ...stored, visibility };

    return aggregateOf();
});
/** Plays the database: the snapshot the service builds is stored as a version row, so the list reads the REAL one. */
const createSnapshot = vi.fn(
    async (input: { readonly recipeId: string; readonly versionNumber: number; readonly snapshot: unknown }) => {
        const row = {
            id: `version-${String(input.versionNumber)}`,
            recipeId: input.recipeId,
            versionNumber: input.versionNumber,
            snapshot: input.snapshot,
            baseVersion: null,
            s3Key: null,
            createdBy: OWNER,
            changeSummary: null,
            editorDisplayName: null,
            editorUsername: null,
            createdAt: AT,
        } as RecipeVersionRow;

        versionRows = [row, ...versionRows];

        return row;
    },
);
/**
 * Plays the database for a clone: the row the DAL writes is the row it hands back, so the clone's detail is mapped
 * from exactly the lines the service decided to write, flag included.
 */
let cloned: RecipeAggregate | undefined;
const create = vi.fn(
    async (input: { readonly ownerId: string; readonly ingredients: readonly IngredientLineInput[] }) => {
        const recipe = makeRecipeRow({
            id: CLONE_ID,
            ownerId: input.ownerId,
            status: 'draft',
            clonedFromId: RECIPE_ID,
        });

        cloned = {
            recipe,
            steps: [makeRecipeStepRow({ recipeId: CLONE_ID })],
            ingredients: input.ingredients.map((line, index) =>
                makeIngredientLineRow({
                    id: `00000000-0000-4000-8000-00000000d30${String(index)}`,
                    recipeId: CLONE_ID,
                    foodLookupId: line.foodLookupId,
                    sortOrder: line.sortOrder,
                    sourceLine: line.sourceLine ?? null,
                    sourceLineTranscribedByOwner: line.sourceLineTranscribedByOwner,
                }),
            ),
        };

        return cloned;
    },
);
const upsert = vi.fn(async () => undefined);
const listRecipes = vi.fn(async () => [{ ...stored, addedVia: 'manual', ingredients: aggregateOf().ingredients }]);

let food: FoodFake;
let booted: BootedServiceApp;

/**
 * One request as `viewer`.
 *
 * @sideEffect One HTTP request.
 */
async function call(viewer: string, method: string, path: string, body?: unknown): Promise<Response> {
    return asPrincipal(viewer, () =>
        fetch(`${booted.baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: bearerFor(viewer) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
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
                useValue: {
                    findById: async (id: string) =>
                        id === RECIPE_ID ? aggregateOf() : id === CLONE_ID ? cloned : undefined,
                    create,
                    findRowById: async (id: string) => (id === RECIPE_ID ? stored : undefined),
                    // The list row is poisoned with the lines: a mapper that ever projected them would leak here.
                    findAll: async () => ({
                        rows: [{ recipe: stored, ingredients: aggregateOf().ingredients }],
                        total: 1,
                    }),
                    update,
                    setVisibility,
                    transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ __tx: true }),
                    lockAndCountPrivateSlots: async () => 0,
                    countPrivateSlots: async () => 0,
                    // The row lock reads the slot AND source facts (#212): the same stored row findRowById holds.
                    lockSlotFacts: async () => ({
                        visibility: stored.visibility,
                        status: stored.status,
                        sourceType: stored.sourceType,
                        sourceKind: stored.sourceKind,
                    }),
                    clearPublicFoodOwners: async () => undefined,
                    privateFoodLines: async () => [],
                },
            },
            {
                provide: VERSIONS_DAL,
                useValue: {
                    createSnapshot,
                    findVersionsBeyondRetention: async () => [],
                    listByRecipe: async () => versionRows,
                },
            },
            { provide: PendingArchivesDal, useValue: { enqueueMany: async () => undefined } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => 4 } },
            { provide: RATINGS_DAL, useValue: { upsert } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            { provide: FoodLookupsDal, useValue: { findByIds: async () => new Map([[ARM.lookupId, ARM]]) } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
            {
                provide: SEARCH_DAL,
                useValue: {
                    search: async () => ({
                        results: [recipeRowToDomain(stored)],
                        facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
                        total: 1,
                    }),
                },
            },
            {
                provide: CollectionsDal,
                useValue: {
                    findById: async () => ({
                        id: COLLECTION_ID,
                        ownerId: OWNER,
                        name: 'Weeknights',
                        description: null,
                        visibility: 'private',
                        sourceCollectionId: null,
                        lastPulledAt: null,
                        createdAt: AT,
                        updatedAt: AT,
                    }),
                    listRecipes,
                    sourceOwnerUsernames: async () => new Map(),
                },
            },
        ],
    });
});

beforeEach(() => {
    stored = makeRecipeRow({ id: RECIPE_ID, ownerId: OWNER, visibility: 'public', status: 'published' });
    versionRows = [];
    cloned = undefined;
});

afterEach(() => {
    vi.clearAllMocks();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/recipes/{id} — who is shown the pasted line (integration: real pipeline, mocked dependencies)', () => {
    it("⛔ shows the OWNER the line on the line that has one, and survives the typed client's parse", async () => {
        const res = await call(OWNER, 'GET', `/api/v1/recipes/${RECIPE_ID}`);
        const raw = (await res.json()) as { ingredients: Record<string, unknown>[] };

        expect(res.status).toBe(200);
        expect(raw.ingredients[0]?.['sourceLine']).toBe(SECRET);
        expect(raw.ingredients[1]).not.toHaveProperty('sourceLine');
        expect(recipeDetailSchema.parse(raw).ingredients[0]?.sourceLine).toBe(SECRET);
    });

    it('⛔ shows ANOTHER cook reading the public recipe neither the key nor the text', async () => {
        const res = await call(OTHER, 'GET', `/api/v1/recipes/${RECIPE_ID}`);
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(text).toContain(RECIPE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });

    it('answers `private, no-store`, because the body differs by viewer', async () => {
        const res = await call(OWNER, 'GET', `/api/v1/recipes/${RECIPE_ID}`);

        expect(res.headers.get('cache-control')).toBe('private, no-store');
    });
});

describe('the writes that return a detail', () => {
    it('⛔ a rating PUT by another cook returns a detail with no line text', async () => {
        const res = await call(OTHER, 'PUT', `/api/v1/recipes/${RECIPE_ID}/rating`, { stars: 4 });
        const text = await res.text();

        expect(res.status, text).toBe(200);
        expect(upsert).toHaveBeenCalledTimes(1);
        expect(text).toContain(RECIPE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });

    // The mock hands back a line that already holds the flag, so what the SERVICE ASKED the DAL to write is asserted
    // on the argument; the real-database half is `tests/e2e/recipes/sourceLineDisclosure.e2e.test.ts`.
    it("⛔ the owner's PATCH that resends the line asks the DAL to keep the flag", async () => {
        const res = await call(OWNER, 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            ingredients: [{ ingredientId: ARM.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'unit' }],
        });
        const written = update.mock.calls[0]?.[1].ingredients?.[0];

        expect(res.status, await res.clone().text()).toBe(200);
        expect(written?.sourceLine).toBe(SECRET);
        expect(written?.sourceLineTranscribedByOwner).toBe(true);
    });

    it("the owner's PATCH returns the line to its owner", async () => {
        const res = await call(OWNER, 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Bread' });
        const raw = (await res.json()) as { ingredients: Record<string, unknown>[] };

        expect(res.status).toBe(200);
        expect(raw.ingredients[0]?.['sourceLine']).toBe(SECRET);
    });

    it("the owner's set-visibility returns the line to its owner", async () => {
        const res = await call(OWNER, 'PATCH', `/api/v1/recipes/${RECIPE_ID}/visibility`, { visibility: 'private' });
        const raw = (await res.json()) as { ingredients: Record<string, unknown>[] };

        expect(res.status).toBe(200);
        expect(setVisibility).toHaveBeenCalledTimes(1);
        expect(raw.ingredients[0]?.['sourceLine']).toBe(SECRET);
    });
});

describe('every surface that is not the owner’s detail read', () => {
    it('⛔ a version snapshot, built from rows that HOLD the line, lists without it', async () => {
        const patched = await call(OWNER, 'PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            title: 'Bread',
        });
        const res = await call(OTHER, 'GET', `/api/v1/recipes/${RECIPE_ID}/versions`);
        const text = await res.text();

        expect(patched.status).toBe(200);
        // Not vacuous: a snapshot WAS cut from the line-bearing rows, and it carries the lines.
        expect(createSnapshot).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(versionRows[0]?.snapshot)).toContain('"ingredients":[{');
        expect(res.status, text).toBe(200);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });

    it('the cook’s recipe list carries no line text', async () => {
        const res = await call(OWNER, 'GET', '/api/v1/recipes');
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(text).toContain(RECIPE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });

    it('a search result carries no line text', async () => {
        const res = await call(OTHER, 'GET', '/api/v1/search/recipes?query=bread');
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(text).toContain(RECIPE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });

    it('a collection’s embedded recipes carry no line text', async () => {
        const res = await call(OWNER, 'GET', `/api/v1/collections/${COLLECTION_ID}`);
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(listRecipes).toHaveBeenCalledTimes(1);
        expect(text).toContain(RECIPE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');
    });
});

/**
 * ADR-0090: a clone COPIES the line's text, because it is what the verification gate judges. The cloner then owns the
 * copy, and "owner only" alone would show them another cook's verbatim words. The line records whether its owner wrote
 * it, so ownership is no longer enough.
 */
describe('a clone — who wrote the copied line', () => {
    it('⛔ shows a cook who cloned ANOTHER cook’s recipe no text, on the clone’s answer or on a read of it', async () => {
        const res = await call(OTHER, 'POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});
        const text = await res.text();

        expect(res.status, text).toBe(201);
        // Not vacuous: the clone really holds the text, under the cloner's ownership.
        expect(cloned?.recipe.ownerId).toBe(OTHER);
        expect(cloned?.ingredients[0]?.sourceLine).toBe(SECRET);
        expect(text).toContain(CLONE_ID);
        expect(text).not.toContain('sourceLine');
        expect(text).not.toContain('GRANDMOTHERS');

        const read = await call(OTHER, 'GET', `/api/v1/recipes/${CLONE_ID}`);
        const readText = await read.text();

        expect(read.status, readText).toBe(200);
        expect(readText).not.toContain('sourceLine');
        expect(readText).not.toContain('GRANDMOTHERS');
    });

    it('shows the owner who cloned their OWN recipe the text they wrote', async () => {
        const res = await call(OWNER, 'POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});
        const raw = (await res.json()) as { ingredients: Record<string, unknown>[] };

        expect(res.status).toBe(201);
        expect(cloned?.recipe.ownerId).toBe(OWNER);
        expect(raw.ingredients[0]?.['sourceLine']).toBe(SECRET);

        const read = await call(OWNER, 'GET', `/api/v1/recipes/${CLONE_ID}`);
        const readRaw = (await read.json()) as { ingredients: Record<string, unknown>[] };

        expect(readRaw.ingredients[0]?.['sourceLine']).toBe(SECRET);
    });
});
