/**
 * A pasted web link as the recipe's source, over the REAL HTTP pipeline with its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a, ADR-0089): the real `AppModule` — routing, the zod pipe, the auth middleware,
 * `RecipesService` and its provenance, visibility and publish policies, the exception filter — with the DALs replaced by
 * doubles and food faked at the network.
 *
 * It pins what the unit tier cannot: that the `statement` reaches the DAL as the four resolved source columns (never as the
 * body stated them), that a web copy is private on the way in, that the correction window closes at the first publish, and
 * that every refusal reaches the wire as the published envelope.
 *
 * Whether the real database stores and constrains the columns is the LOCAL e2e tier's (`recipeSourceKind.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { recipeApiErrorSchema } from '../../../src/common/apiError.schema.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { RecipeRow } from '../../../src/database/schema/index.js';
import type { FoodLookupArm } from '../../../src/database/schema/foodLookupArm.js';
import { FoodLookupsDal } from '../../../src/ingredients/dal/foodLookups.dal.js';
import type { RecipeAggregate, UpdateRecipeInput } from '../../../src/recipes/dal/recipes.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { PendingArchivesDal } from '../../../src/versions/dal/pendingArchives.dal.js';
import { VERSIONS_DAL } from '../../../src/versions/versions.service.js';
import type { Principal } from '../../../src/auth/principal.js';
import { resolveStatementProvenance } from '../../../src/recipes/domain/provenancePolicy.js';
import { createRecipeRequestSchema } from '../../../src/recipes/recipes.schema.js';
import { RecipesService } from '../../../src/recipes/recipes.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JSOURCESTATEMENTCOOK0001';
const RECIPE_ID = '00000000-0000-4000-8000-0000000000e1';
const AT = new Date('2026-11-10T00:00:00.000Z');
const BASIL: FoodLookupArm = {
    kind: 'root',
    lookupId: '00000000-0000-4000-8000-00000000e101',
    foodId: 'R-basil',
    foodOwnerId: null,
    createdAt: AT,
};
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const STATEMENT = { kind: 'public_web', citation: LINK } as const;

/** The recipe the double holds. Each test sets it. */
let stored: RecipeRow;

function aggregateOf(recipe: RecipeRow): RecipeAggregate {
    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [makeIngredientLineRow({ recipeId: recipe.id, foodLookupId: BASIL.lookupId, quantity: '1' })],
    };
}

const create = vi.fn(async (input: Partial<RecipeRow>) => {
    stored = makeRecipeRow({ ...input, id: RECIPE_ID, ownerId: COOK });

    return aggregateOf(stored);
});
const update = vi.fn(async (_id: string, patch: UpdateRecipeInput) => {
    stored = {
        ...stored,
        ...(patch.provenance === undefined ? {} : patch.provenance),
        ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
        currentVersion: stored.currentVersion + 1,
    };

    return aggregateOf(stored);
});

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

/** A create body that is a DRAFT, so no private slot is counted: the slot rule is the unchanged one, not this suite's. */
const DRAFT_BODY = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: BASIL.lookupId, quantity: { kind: 'exact', value: 1 }, unit: 'cup' }],
    steps: [{ instruction: 'Simmer.' }],
    status: 'draft',
};

/** The typed refusal a response carries. */
async function refusalOf(response: Response): Promise<{ status: number; code: string; details: unknown }> {
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
                    privateFoodLines: async () => [],
                    lockAndCountPrivateSlots: async () => 0,
                    lockSlotFacts: async () => ({ visibility: stored.visibility, status: stored.status }),
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
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            {
                provide: FoodLookupsDal,
                useValue: {
                    findByIds: async (ids: readonly string[]) =>
                        new Map(ids.includes(BASIL.lookupId) ? [[BASIL.lookupId, BASIL]] : []),
                },
            },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
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

describe('POST /api/v1/recipes — a statement makes a private web copy', () => {
    it('persists the four resolved source columns and the private visibility', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceUrl: LINK,
                sourceAttribution: 'allrecipes.com',
                sourceKind: 'public_web',
                visibility: 'private',
            }),
            expect.anything(),
        );
    });

    it('returns the kind, so a client can judge the source from the response', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(await response.json()).toMatchObject({
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });
    });

    it('refuses public for a web copy with the existing private-only denial, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', { ...DRAFT_BODY, statement: STATEMENT });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(create).not.toHaveBeenCalled();
    });

    it('asks a web copy for a cuisine to publish, unlike the curator’s text', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            status: 'published',
            visibility: 'private',
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 400,
            code: 'PUBLISH_REQUIREMENTS_UNMET',
            details: { missing: ['cuisine'] },
        });
    });

    it('answers 400 for a body carrying BOTH the curator source and the statement, and writes nothing', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: STATEMENT,
            source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/b', sourceAttribution: 'A book' },
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });

    it('answers 400 for a statement whose link is our own site', async () => {
        const response = await call('POST', '/api/v1/recipes', {
            ...DRAFT_BODY,
            visibility: 'private',
            statement: { kind: 'public_web', citation: 'https://commise.app/recipes/1' },
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
        expect(create).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/v1/recipes/{id} — the source can be settled until the first publish (ADR-0058, ADR-0089)', () => {
    it('sets a statement on a never-published draft, and the public draft becomes private in the same write', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', visibility: 'public' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                visibility: 'private',
                provenance: {
                    sourceType: 'imported_public',
                    sourceUrl: LINK,
                    sourceAttribution: 'allrecipes.com',
                    sourceKind: 'public_web',
                },
            }),
            expect.anything(),
        );
        expect(await response.json()).toMatchObject({ visibility: 'private', sourceKind: 'public_web' });
    });

    it('sets Private on EVERY write that sets a source, whatever visibility the read saw', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft', visibility: 'private' });

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: STATEMENT });

        expect(update.mock.calls[0]?.[1]).toHaveProperty('visibility', 'private');
    });

    it('refuses a statement on a clone whose web source was inherited (no relabel by clone)', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            clonedFromId: '00000000-0000-4000-8000-0000000000c1',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('clears the statement with null: the source goes back to none and visibility is left as it is', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'private',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            RECIPE_ID,
            expect.objectContaining({
                provenance: { sourceType: 'user_created', sourceUrl: null, sourceAttribution: null, sourceKind: null },
            }),
            expect.anything(),
        );
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('visibility');
    });

    it('leaves the source alone when the body carries no statement', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft' });

        await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, title: 'Soup 2' });

        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('provenance');
    });

    it('refuses a statement after the first publish with 403 FORBIDDEN, details.reason SOURCE_LOCKED, writing nothing', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'published', cuisine: 'Italian' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({
            status: 403,
            code: 'FORBIDDEN',
            details: { reason: 'SOURCE_LOCKED' },
        });
        expect(update).not.toHaveBeenCalled();
    });

    it('also refuses clearing a statement after the first publish, and a re-drafted recipe stays locked', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            firstPublishedAt: AT,
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
            visibility: 'private',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, { expectedVersion: 1, statement: null });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses to overwrite a source the cook did not state (the curator’s text), even on a draft', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            sourceType: 'imported_public',
            sourceKind: null,
            sourceUrl: 'https://www.gutenberg.org/cache/epub/1/pg1.txt',
            sourceAttribution: 'A book',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            statement: STATEMENT,
        });

        expect(await refusalOf(response)).toMatchObject({ status: 403, details: { reason: 'SOURCE_LOCKED' } });
        expect(update).not.toHaveBeenCalled();
    });

    it('refuses to PUBLISH a public web-copy draft (the state after the write), writing nothing', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'draft',
            visibility: 'public',
            cuisine: 'Italian',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            status: 'published',
        });

        expect(await refusalOf(response)).toMatchObject({ status: 400, code: 'INVALID_VISIBILITY' });
        expect(update).not.toHaveBeenCalled();
    });

    it('still answers 400 for the curator `source` on a PATCH: provenance by declaration is create-only', async () => {
        stored = makeRecipeRow({ id: RECIPE_ID, ownerId: COOK, status: 'draft' });

        const response = await call('PATCH', `/api/v1/recipes/${RECIPE_ID}`, {
            expectedVersion: 1,
            source: { sourceType: 'imported_public', sourceUrl: 'https://example.com/b', sourceAttribution: 'A book' },
        });

        expect(response.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
    });
});

// The bulk import (ADR-0072 section 9) calls `RecipesService.create` with its statement's provenance, an INTERNAL argument. A
// web statement must resolve to the web copy and so can never be saved public, whatever the item asked for.
describe('RecipesService.create with the bulk import’s provenance (ADR-0089)', () => {
    const importedPrincipal: Principal = {
        userId: COOK,
        sub: `test:${COOK}`,
        scopes: [],
        permissions: [],
        roles: [],
        principalKind: 'real',
        containment: 'enforce',
    };
    const provenance = resolveStatementProvenance({ kind: 'public_web', citation: LINK });

    function createWith(over: Record<string, unknown>) {
        if (provenance === undefined) {
            throw new Error('test setup: the statement must resolve');
        }

        return booted.app
            .get(RecipesService)
            .create(importedPrincipal, createRecipeRequestSchema.parse({ ...DRAFT_BODY, ...over }), undefined, {
                provenance,
                lineOrigins: [{ kind: 'cook' }],
            });
    }

    it('REFUSES a public save of a public_web item, and writes nothing', async () => {
        await expect(createWith({ visibility: 'public' })).rejects.toMatchObject({ code: 'INVALID_VISIBILITY' });
        expect(create).not.toHaveBeenCalled();
    });

    it('a private save stores the web copy WITH its kind, so it never reads as the curator’s text', async () => {
        await createWith({ visibility: 'private' });

        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: LINK,
                visibility: 'private',
            }),
            expect.anything(),
        );
    });
});

describe('POST /api/v1/recipes/{id}/clone — the kind travels with the source', () => {
    it('copies the source kind, and the clone of a web copy lands private', async () => {
        stored = makeRecipeRow({
            id: RECIPE_ID,
            ownerId: COOK,
            status: 'published',
            visibility: 'private',
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: LINK,
            sourceAttribution: 'allrecipes.com',
        });

        const response = await call('POST', `/api/v1/recipes/${RECIPE_ID}/clone`, {});

        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceType: 'imported_public',
                sourceKind: 'public_web',
                sourceUrl: LINK,
                visibility: 'private',
            }),
            expect.anything(),
        );
    });
});
