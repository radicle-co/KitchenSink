/**
 * The owner-only `hiddenReason` on the owner's list and on a collection's members, over the REAL HTTP pipeline with the DALs
 * MOCKED (`docs/CODING_STANDARDS.md` section 7.1a). That the database computes the facts is the LOCAL e2e tier's
 * (`hiddenReason.e2e.test.ts`); the detail and search producers have their own unit tests beside the code.
 *
 * Each endpoint carries its control: the same held public row, handed on purpose past the read rule, to a viewer who does
 * not own the RECIPE (in a collection they do own) gets no key.
 */
import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { makeRecipeRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { ReadableRecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import { RATINGS_DAL } from '../../../src/ratings/ratings.service.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const OWNER = '01JHIDDENREASONOWNER00001';
const COLLECTOR = '01JHIDDENREASONCOLLECT001';
const COLLECTION_ID = '00000000-0000-4000-8000-0000000c0001';
const NOW = new Date('2026-11-28T00:00:00.000Z');

const held = makeRecipeRow({
    id: '00000000-0000-4000-8000-00000000d101',
    ownerId: OWNER,
    visibility: 'public',
    sourceCorrectionHold: true,
});
const READER = '01JHIDDENREASONREADER0001';
const stored = new Map<string, ReadableRecipeAggregate>();
const heldFacts = new Map<string, boolean>();
const clean = makeRecipeRow({ id: '00000000-0000-4000-8000-00000000d102', ownerId: OWNER, visibility: 'public' });

const aggregateOf = (recipe: ReturnType<typeof makeRecipeRow>, heldFromReaders: boolean): ReadableRecipeAggregate => ({
    recipe: { ...recipe, heldFromReaders },
    steps: [],
    ingredients: [],
});

let booted: BootedServiceApp;

function get(as: string, path: string): Promise<Response> {
    return asPrincipal(as, () => fetch(`${booted.baseUrl}${path}`, { headers: { authorization: bearerFor(as) } }));
}

const collection = (ownerId: string) => ({
    id: COLLECTION_ID,
    ownerId,
    name: 'Mine',
    description: null,
    visibility: 'private' as const,
    sourceCollectionId: null,
    sourceOwnerDisplayName: null,
    sourceCollectionName: null,
    lastPulledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
});

let collectionOwner = OWNER;

beforeAll(async () => {
    stored.set(held.id, aggregateOf(held, true));
    stored.set(clean.id, aggregateOf(clean, false));
    heldFacts.set(held.id, true);

    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    findById: async (id: string) => stored.get(id),
                    findRowById: async (id: string) => stored.get(id)?.recipe,
                    privateFoodLines: async () => [],
                    // The database's answer for the OWNER's read, supplied by the suite for each recipe it stores.
                    findOwnerHiddenFacts: async (id: string) => ({
                        ownerHeldFromReaders: heldFacts.get(id) ?? false,
                        hasCookSourceEvidence: false,
                    }),
                    findAll: vi.fn(async () => ({
                        rows: [
                            { recipe: held, ownerHeldFromReaders: true, hasCookSourceEvidence: false },
                            { recipe: clean, ownerHeldFromReaders: false, hasCookSourceEvidence: false },
                        ],
                        total: 2,
                    })),
                },
            },
            {
                provide: CollectionsDal,
                useValue: {
                    findById: async () => collection(collectionOwner),
                    sourceOwnerUsernames: async () => new Map(),
                    listRecipes: async () => [
                        { ...held, addedVia: 'manual', ownerHeldFromReaders: true, hasCookSourceEvidence: false },
                        { ...clean, addedVia: 'manual', ownerHeldFromReaders: false, hasCookSourceEvidence: false },
                    ],
                },
            },
            { provide: RATINGS_DAL, useValue: { upsert: async () => ({}), delete: async () => undefined } },
            { provide: RecipeSourceEvidenceDal, useValue: { list: async () => [] } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: async () => [] } },
            { provide: RECIPE_RATINGS_DAL, useValue: { findStars: async () => undefined, upsert: async () => ({}) } },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: { findBandsByKeys: async () => new Map(), findExistingKeys: async () => new Set() },
            },
            { provide: AuthorHandlesDal, useValue: { findByline: async () => undefined } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterAll(async () => {
    await booted?.close();
});

describe('GET /api/v1/recipes (the owner list)', () => {
    it('gives the owner the reason on the held recipe only', async () => {
        const body = (await (await get(OWNER, '/api/v1/recipes')).json()) as { data: Array<{ id: string }> };
        const byId = Object.fromEntries(body.data.map((item) => [item.id, item]));

        expect(byId[held.id]).toMatchObject({ hiddenReason: 'sourceCorrected' });
        expect(byId[clean.id]).not.toHaveProperty('hiddenReason');
    });
});

describe('GET /api/v1/collections/:id (members)', () => {
    it("gives the recipe's owner the reason, and the collection's owner nothing for another cook's held recipe (AE3)", async () => {
        collectionOwner = OWNER;
        const asRecipeOwner = (await (await get(OWNER, `/api/v1/collections/${COLLECTION_ID}`)).json()) as {
            recipes: Array<{ id: string }>;
        };

        expect(asRecipeOwner.recipes.find((r) => r.id === held.id)).toMatchObject({ hiddenReason: 'sourceCorrected' });
        expect(asRecipeOwner.recipes.find((r) => r.id === clean.id)).not.toHaveProperty('hiddenReason');

        collectionOwner = COLLECTOR;
        const asCollector = (await (await get(COLLECTOR, `/api/v1/collections/${COLLECTION_ID}`)).json()) as {
            recipes: Array<{ id: string }>;
        };

        expect(asCollector.recipes).toHaveLength(2);
        expect(asCollector.recipes.find((r) => r.id === held.id)).not.toHaveProperty('hiddenReason');
    });
});

describe('GET /api/v1/recipes/:id and the rating write (detail producers)', () => {
    it('gives the owner the reason on a held recipe, and nothing on a recipe nothing holds', async () => {
        const heldBody = (await (await get(OWNER, `/api/v1/recipes/${held.id}`)).json()) as Record<string, unknown>;
        const cleanBody = (await (await get(OWNER, `/api/v1/recipes/${clean.id}`)).json()) as Record<string, unknown>;

        expect(heldBody['hiddenReason']).toBe('sourceCorrected');
        expect(cleanBody).not.toHaveProperty('hiddenReason');
    });

    it('answers cook B a 404 for the held recipe and a body with no key for a readable one', async () => {
        expect((await get(READER, `/api/v1/recipes/${held.id}`)).status).toBe(404);

        const readable = await get(READER, `/api/v1/recipes/${clean.id}`);

        expect(readable.status).toBe(200);
        expect(await readable.json()).not.toHaveProperty('hiddenReason');
    });

    it('answers the rating write by cook B (a non-owner) with a detail that has no key', async () => {
        const response = await asPrincipal(READER, () =>
            fetch(`${booted.baseUrl}/api/v1/recipes/${clean.id}/rating`, {
                method: 'PUT',
                headers: { authorization: bearerFor(READER), 'content-type': 'application/json' },
                body: JSON.stringify({ stars: 4 }),
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).not.toHaveProperty('hiddenReason');
    });
});
