/**
 * The owner-only `hiddenReason` on the owner's list and on a collection's members, over the REAL HTTP pipeline with the DALs
 * MOCKED (`docs/CODING_STANDARDS.md` section 7.1a). That the database computes the facts is the LOCAL e2e tier's
 * (`hiddenReason.e2e.test.ts`); the detail and search producers have their own unit tests beside the code.
 *
 * Each endpoint carries its control: the same held public row, handed on purpose past the read rule, to a viewer who does
 * not own the RECIPE (in a collection they do own) gets no key.
 */
import 'reflect-metadata';

import { is, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { makeRecipeRow } from '../../../src/__fixtures__/index.js';
import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import { CollectionsDal } from '../../../src/collections/dal/collections.dal.js';
import { AuthorHandlesDal } from '../../../src/authors/dal/authorHandles.dal.js';
import type { ReadableRecipeAggregate } from '../../../src/recipes/dal/recipes.dal.js';
import { makeRawRecipeSearchRow } from '../../../src/search/__fixtures__/search.fixtures.js';
import { SearchDal } from '../../../src/search/dal/search.dal.js';
import { SEARCH_DAL } from '../../../src/search/search.service.js';
import { makeFakeDrizzle } from '../../../src/__testing__/makeFakeDrizzle.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { RATINGS_DAL } from '../../../src/ratings/ratings.service.js';
import { RecipeSourceEvidenceDal } from '../../../src/recipes/dal/recipeSourceEvidence.dal.js';
import {
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_DAL,
    RECIPE_RATINGS_DAL,
} from '../../../src/recipes/recipes.tokens.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor } from '../../../tests/support/foodFake.js';
import { recipesDalDouble } from '../../../tests/support/recipesDalDouble.js';
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
/** Public, no correction hold: held by the DATABASE's evidence term alone (the `heldSource` path), and its no-evidence twin (`other`). */
const evidenceHeld = makeRecipeRow({
    id: '00000000-0000-4000-8000-00000000d103',
    ownerId: OWNER,
    visibility: 'public',
});
const unmappedHeld = makeRecipeRow({
    id: '00000000-0000-4000-8000-00000000d104',
    ownerId: OWNER,
    visibility: 'public',
});
const clean = makeRecipeRow({ id: '00000000-0000-4000-8000-00000000d102', ownerId: OWNER, visibility: 'public' });

const aggregateOf = (recipe: ReturnType<typeof makeRecipeRow>, heldFromReaders: boolean): ReadableRecipeAggregate => ({
    recipe: { ...recipe, heldFromReaders },
    steps: [],
    ingredients: [],
});

/**
 * The REAL search DAL over a fake `db.execute`: every statement answers the held public recipe of OWNER, flagged held for the
 * owner by a database that (on purpose) ignores who asks. So a gate that is missing in the DAL, the service, the controller or
 * the response schema shows up as a key on the wire.
 */
let searchedRow: Record<string, unknown> = {};
const fakeSearch = makeFakeDrizzle<RecipeDrizzle>({ executeRows: () => [searchedRow] });

/** The first statement the fake received since `mark`, as Postgres text. */
let mark = 0;

const pageSqlSinceMark = (): string => {
    const call = fakeSearch.calls.slice(mark).find((recorded) => recorded.method === 'execute');
    const statement = call?.args[0];

    if (!is(statement, SQL)) {
        throw new Error('the search DAL ran no SQL');
    }

    return new PgDialect().sqlToQuery(statement).sql;
};

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
            recipesDalDouble({
                findById: (id: string) => Promise.resolve(stored.get(id)),
                findRowById: (id: string) => Promise.resolve(stored.get(id)?.recipe),
                privateFoodLines: () => Promise.resolve([]),
                // The database's answer for the OWNER's read, supplied by the suite for each recipe it stores.
                findOwnerHiddenFacts: (id: string) =>
                    Promise.resolve({ ownerHeldFromReaders: heldFacts.get(id) ?? false, hasCookSourceEvidence: false }),
                findAll: () =>
                    Promise.resolve({
                        rows: [
                            { recipe: held, ownerHeldFromReaders: true, hasCookSourceEvidence: false },
                            { recipe: evidenceHeld, ownerHeldFromReaders: true, hasCookSourceEvidence: true },
                            { recipe: unmappedHeld, ownerHeldFromReaders: true, hasCookSourceEvidence: false },
                            { recipe: clean, ownerHeldFromReaders: false, hasCookSourceEvidence: false },
                        ],
                        total: 2,
                    }),
            }),
            {
                provide: CollectionsDal,
                useValue: {
                    findById: () => Promise.resolve(collection(collectionOwner)),
                    sourceOwnerUsernames: () => Promise.resolve(new Map()),
                    listRecipes: () =>
                        Promise.resolve([
                            { ...held, addedVia: 'manual', ownerHeldFromReaders: true, hasCookSourceEvidence: false },
                            {
                                ...evidenceHeld,
                                addedVia: 'manual',
                                ownerHeldFromReaders: true,
                                hasCookSourceEvidence: true,
                            },
                            {
                                ...unmappedHeld,
                                addedVia: 'manual',
                                ownerHeldFromReaders: true,
                                hasCookSourceEvidence: false,
                            },
                            { ...clean, addedVia: 'manual', ownerHeldFromReaders: false, hasCookSourceEvidence: false },
                        ]),
                },
            },
            { provide: SEARCH_DAL, useValue: new SearchDal(fakeSearch.db) },
            {
                provide: RATINGS_DAL,
                useValue: { upsert: () => Promise.resolve({}), delete: () => Promise.resolve(undefined) },
            },
            { provide: RecipeSourceEvidenceDal, useValue: { list: () => Promise.resolve([]) } },
            { provide: RECIPE_PHOTOS_DAL, useValue: { findByRecipe: () => Promise.resolve([]) } },
            {
                provide: RECIPE_RATINGS_DAL,
                useValue: { findStars: () => Promise.resolve(undefined), upsert: () => Promise.resolve({}) },
            },
            {
                provide: RECIPE_LINE_VERIFICATIONS_DAL,
                useValue: {
                    findBandsByKeys: () => Promise.resolve(new Map()),
                    findExistingKeys: () => Promise.resolve(new Set()),
                },
            },
            { provide: AuthorHandlesDal, useValue: { findByline: () => Promise.resolve(undefined) } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: () => Promise.resolve(undefined) } },
        ],
    });
});

afterAll(async () => {
    await booted.close();
});

describe('GET /api/v1/recipes (the owner list)', () => {
    it('gives the owner the reason on the held recipe only', async () => {
        const body = (await (await get(OWNER, '/api/v1/recipes')).json()) as { data: Array<{ id: string }> };
        const byId = Object.fromEntries(body.data.map((item) => [item.id, item]));

        expect(byId[held.id]).toMatchObject({ hiddenReason: 'sourceCorrected' });
        // The evidence term and its absence, through the list service: the pair pins both inputs.
        expect(byId[evidenceHeld.id]).toMatchObject({ hiddenReason: 'heldSource' });
        expect(byId[unmappedHeld.id]).toMatchObject({ hiddenReason: 'other' });
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
        expect(asRecipeOwner.recipes.find((r) => r.id === evidenceHeld.id)).toMatchObject({
            hiddenReason: 'heldSource',
        });
        expect(asRecipeOwner.recipes.find((r) => r.id === unmappedHeld.id)).toMatchObject({ hiddenReason: 'other' });
        expect(asRecipeOwner.recipes.find((r) => r.id === clean.id)).not.toHaveProperty('hiddenReason');

        collectionOwner = COLLECTOR;
        const asCollector = (await (await get(COLLECTOR, `/api/v1/collections/${COLLECTION_ID}`)).json()) as {
            recipes: Array<{ id: string }>;
        };

        expect(asCollector.recipes).toHaveLength(4);

        for (const member of asCollector.recipes) {
            expect(member).not.toHaveProperty('hiddenReason');
        }
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

describe('the read paths that must never carry the key (qse rows a, b, c)', () => {
    it('(a) detail read by a non-owner: no key, even when the double reports the recipe held with evidence for the owner', async () => {
        heldFacts.set(clean.id, true);

        const response = await get(READER, `/api/v1/recipes/${clean.id}`);

        expect(response.status).toBe(200);
        expect(await response.json()).not.toHaveProperty('hiddenReason');
        heldFacts.delete(clean.id);
    });

    it('(b) search by another cook: no item carries the key, though the database row says held', async () => {
        searchedRow = makeRawRecipeSearchRow({
            id: held.id,
            owner_id: OWNER,
            owner_held_from_readers: true,
            source_correction_hold: true,
        });

        const response = await get(READER, '/api/v1/search/recipes?query=pasta');
        const body = (await response.json()) as { results: Array<{ recipe: Record<string, unknown> }> };

        expect(response.status).toBe(200);
        expect(body.results).toHaveLength(1);
        expect(body.results[0].recipe).not.toHaveProperty('hiddenReason');
    });

    it('(c) community search by the owner: the page read selects false for both facts, and no item carries the key', async () => {
        mark = fakeSearch.calls.length;
        // What the database answers to a statement that selects `false`: the owner's own row is never in this scope.
        searchedRow = makeRawRecipeSearchRow({
            id: held.id,
            owner_id: OWNER,
            owner_held_from_readers: false,
            source_correction_hold: true,
        });

        const response = await get(OWNER, '/api/v1/search/recipes?query=pasta&scope=community');
        const body = (await response.json()) as { results: Array<{ recipe: Record<string, unknown> }> };
        const pageSql = pageSqlSinceMark();

        expect(response.status).toBe(200);
        expect(pageSql).toContain('false AS owner_held_from_readers');
        expect(pageSql).toContain('false AS has_cook_source_evidence');
        expect(body.results).toHaveLength(1);
        expect(body.results[0].recipe).not.toHaveProperty('hiddenReason');
    });

    it('control: the owner searching without a scope gets the reason on the same row', async () => {
        searchedRow = makeRawRecipeSearchRow({
            id: held.id,
            owner_id: OWNER,
            owner_held_from_readers: true,
            source_correction_hold: true,
        });

        const body = (await (await get(OWNER, '/api/v1/search/recipes?query=pasta')).json()) as {
            results: Array<{ recipe: Record<string, unknown> }>;
        };

        expect(body.results[0]?.recipe).toMatchObject({ hiddenReason: 'sourceCorrected' });
    });
});
