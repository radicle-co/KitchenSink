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
import { RECIPES_DAL } from '../../../src/recipes/recipes.tokens.js';
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
const clean = makeRecipeRow({ id: '00000000-0000-4000-8000-00000000d102', ownerId: OWNER, visibility: 'public' });

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
    booted = await bootMockedRecipeApp({
        doubles: [
            {
                provide: RECIPES_DAL,
                useValue: {
                    findAll: vi.fn(async () => ({
                        rows: [
                            { recipe: held, heldFromReaders: true, hasCookSourceEvidence: false },
                            { recipe: clean, heldFromReaders: false, hasCookSourceEvidence: false },
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
                        { ...held, addedVia: 'manual', heldFromReaders: true, hasCookSourceEvidence: false },
                        { ...clean, addedVia: 'manual', heldFromReaders: false, hasCookSourceEvidence: false },
                    ],
                },
            },
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
