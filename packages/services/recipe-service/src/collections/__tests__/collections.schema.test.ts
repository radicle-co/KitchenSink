/**
 * THE COLLECTIONS WIRE CONTRACT, ASSERTED AGAINST THE IMPLEMENTATION THAT SERVES IT.
 *
 * `collections.schema.ts` is now the single authoritative statement of what this vertical puts on the
 * wire: `@kitchensink/schema-recipe` publishes it verbatim, `openapi.yaml` is derived from it, and
 * `@kitchensink/recipe-service-client` PARSES production responses with it. A schema that is merely
 * plausible is therefore worse than no schema — it would make every real response a client-side throw.
 *
 * So the load-bearing half of this suite drives {@link CollectionsService} over a stubbed DAL and parses
 * its ACTUAL return value with the published schema. That is what makes the contract empirically true
 * rather than hopeful, and it is written to fail if either side moves: change the mapper and the parse
 * reds; change the schema and the parse reds.
 *
 * The second half pins the four DRIFTS this file resolved, each as a test that fails if the resolution is
 * reverted:
 *
 *  1. `recipes` on the collection-with-recipes body is REQUIRED (the client had it optional). The server
 *     always sends it — `getCollection` sets it unconditionally — so absent-means-empty was never a state
 *     the server could produce, and a client rendering "no recipes loaded" for it was rendering a
 *     phantom.
 *  2. `visibility` on the UPDATE request is the NARROWED enum (the server's input type said raw `string`).
 *  3. `visibility` everywhere is `@kitchensink/recipe-core`'s `recipeVisibilitySchema` — the DOMAIN type —
 *     never the drizzle `CollectionVisibility`, which is a STORAGE type and must not reach the wire.
 *  4. `Collection` is COMPOSED from recipe-core's `collectionSchema` (which already owns `visibility` and
 *     `recipeCount`) rather than re-declared. `composes recipe-core` below fails if someone re-declares it.
 */
import { describe, expect, it, vi } from 'vitest';
import { collectionSchema, recipeVisibilitySchema } from '@kitchensink/recipe-core';

import { AuthorHandlesDal } from '../../authors/dal/authorHandles.dal.js';
import { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../__fixtures__/collections.fixtures.js';
import {
    collectionListResponseSchema,
    collectionRecipeMembershipResponseSchema,
    collectionResponseSchema,
    collectionWithRecipesResponseSchema,
    pullDiffSchema,
    pullFromSourceResponseSchema,
    updateCollectionRequestSchema,
} from '../collections.schema.js';

const OWNER = 'owner-1';
const COLLECTION_ID = '00000000-0000-4000-8000-0000000000c1';
const SOURCE_ID = '00000000-0000-4000-8000-0000000000c2';
const RECIPE_ID = '00000000-0000-4000-8000-000000000001';

type DalMock = { [K in keyof CollectionsDal]: ReturnType<typeof vi.fn> };

/**
 * A DAL stub whose every method is a `vi.fn()`. Deliberately built from the real class's key set so a new
 * DAL method cannot be silently un-stubbed here.
 */
function makeDal(): DalMock {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        countByOwner: vi.fn(),
        createIfUnderCap: vi.fn(),
        update: vi.fn(),
        deleteById: vi.fn(),
        findActiveRecipe: vi.fn(),
        addRecipe: vi.fn(),
        addRecipes: vi.fn(),
        findMembership: vi.fn(),
        removeRecipe: vi.fn(),
        listRecipes: vi.fn(),
        previewMembershipIds: vi.fn(),
        touchLastPulled: vi.fn(),
        transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    };
}

function makeService(dal: DalMock): CollectionsService {
    return new CollectionsService(
        dal as unknown as CollectionsDal,
        {
            findHandle: vi.fn().mockResolvedValue('chef-anon'),
            applyRename: vi.fn(),
        } as unknown as AuthorHandlesDal,
        { capture: vi.fn() } as unknown as AnalyticsService,
    );
}

/** A fully-populated row — every nullable column set — so the parse exercises the widest body. */
function makeFullRow(): ReturnType<typeof makeCollectionRow> {
    return makeCollectionRow({
        description: 'Fast midweek meals',
        visibility: 'public',
        sourceCollectionId: SOURCE_ID,
        sourceOwnerHandle: 'chef-anon',
        sourceCollectionName: 'Their Dinners',
        lastPulledAt: new Date('2026-02-02T00:00:00.000Z'),
    });
}

describe('the published collection body is TRUE of what CollectionsService emits', () => {
    it('createCollection — a minimal row (every nullable column NULL) parses', async () => {
        const dal = makeDal();
        dal.createIfUnderCap.mockResolvedValue(makeCollectionRow());

        const result = await makeService(dal).createCollection(OWNER, { name: 'Weeknight Dinners' });

        expect(collectionResponseSchema.parse(result)).toEqual(result);
    });

    it('createCollection — a fully-populated row parses, including the three pull-provenance projections', async () => {
        const dal = makeDal();
        dal.createIfUnderCap.mockResolvedValue(makeFullRow());

        const result = await makeService(dal).createCollection(OWNER, { name: 'Weeknight Dinners' });

        const parsed = collectionResponseSchema.parse(result);
        expect(parsed).toEqual(result);
        // Named explicitly: these three are the reason the contract EXTENDS recipe-core's `collectionSchema`
        // instead of using it bare. Parsed with the bare schema they would be silently STRIPPED, and the
        // wider TypeScript type would then be a lie about what `parse` returned.
        expect(parsed).toMatchObject({
            sourceOwnerHandle: 'chef-anon',
            sourceCollectionName: 'Their Dinners',
            lastPulledAt: '2026-02-02T00:00:00.000Z',
        });
    });

    it('listCollections — the paginated envelope parses', async () => {
        const dal = makeDal();
        dal.listByOwner.mockResolvedValue({ rows: [makeCollectionRow(), makeFullRow()], total: 2 });

        const result = await makeService(dal).listCollections(OWNER, { page: 1, pageSize: 20 });

        expect(collectionListResponseSchema.parse(result)).toEqual(result);
    });

    it('listCollections — an EMPTY page parses (the boundary a hopeful schema usually gets wrong)', async () => {
        const dal = makeDal();
        dal.listByOwner.mockResolvedValue({ rows: [], total: 0 });

        const result = await makeService(dal).listCollections(OWNER, { page: 1, pageSize: 20 });

        expect(collectionListResponseSchema.parse(result)).toEqual(result);
    });

    it('getCollection — the collection plus its embedded member recipes parses', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeFullRow());
        dal.listRecipes.mockResolvedValue([{ ...makeRecipeRow(), addedVia: 'clone_seed' }]);

        const result = await makeService(dal).getCollection(OWNER, COLLECTION_ID);

        expect(collectionWithRecipesResponseSchema.parse(result)).toEqual(result);
    });

    it('getCollection — an EMPTY recipes array parses, and `recipes` is still PRESENT (drift 1)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow());
        dal.listRecipes.mockResolvedValue([]);

        const result = await makeService(dal).getCollection(OWNER, COLLECTION_ID);

        expect(collectionWithRecipesResponseSchema.parse(result)).toEqual(result);
        expect(result).toHaveProperty('recipes', []);
        expect(result.recipeCount).toBe(0);
    });

    it('addRecipe — the created membership parses (note the wire field is `createdAt`, not the row’s `addedAt`)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow());
        dal.findActiveRecipe.mockResolvedValue(makeRecipeRow());
        dal.addRecipe.mockResolvedValue({ row: makeMembershipRow(), created: true });

        const result = await makeService(dal).addRecipe(OWNER, COLLECTION_ID, RECIPE_ID);

        expect(collectionRecipeMembershipResponseSchema.parse(result)).toEqual(result);
    });

    it('cloneCollection — the clone parses, with the frozen source attribution present', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ visibility: 'public' }));
        dal.listRecipes.mockResolvedValue([makeRecipeRow()]);
        dal.create.mockResolvedValue(
            makeCollectionRow({
                id: SOURCE_ID,
                sourceCollectionId: COLLECTION_ID,
                sourceOwnerHandle: 'chef-anon',
                sourceCollectionName: 'Weeknight Dinners',
            }),
        );

        const result = await makeService(dal).cloneCollection(OWNER, COLLECTION_ID);

        expect(collectionResponseSchema.parse(result)).toEqual(result);
    });

    it('previewPull — the three-way diff parses', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ sourceCollectionId: SOURCE_ID }));
        dal.previewMembershipIds.mockResolvedValue({ cloneIds: [RECIPE_ID], sourceIds: [RECIPE_ID, SOURCE_ID] });

        const result = await makeService(dal).previewPull(OWNER, COLLECTION_ID);

        expect(pullDiffSchema.parse(result)).toEqual(result);
    });

    it('pullFromSource — the refreshed collection plus the added ids parses', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ sourceCollectionId: SOURCE_ID }));
        dal.previewMembershipIds.mockResolvedValue({ cloneIds: [], sourceIds: [RECIPE_ID] });
        dal.touchLastPulled.mockResolvedValue(makeFullRow());

        const result = await makeService(dal).pullFromSource(OWNER, COLLECTION_ID);

        expect(pullFromSourceResponseSchema.parse(result)).toEqual(result);
    });
});

describe('drift 1 — `recipes` is REQUIRED on the collection-with-recipes body', () => {
    it('REJECTS a body with no `recipes` key, because the server can never send one', () => {
        const withoutRecipes = collectionResponseSchema.parse({
            id: COLLECTION_ID,
            ownerId: OWNER,
            name: 'Weeknight Dinners',
            visibility: 'private',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });

        expect(collectionWithRecipesResponseSchema.safeParse(withoutRecipes).success).toBe(false);
    });
});

describe('drift 2 — the UPDATE request narrows `visibility` to the enum', () => {
    it('accepts the two legal literals', () => {
        expect(updateCollectionRequestSchema.parse({ visibility: 'public' })).toEqual({ visibility: 'public' });
        expect(updateCollectionRequestSchema.parse({ visibility: 'private' })).toEqual({ visibility: 'private' });
    });

    it('REJECTS an arbitrary string, which the raw-`string` input type used to admit as far as the type system', () => {
        expect(updateCollectionRequestSchema.safeParse({ visibility: 'unlisted' }).success).toBe(false);
    });
});

describe('drift 3 — `visibility` is the recipe-core DOMAIN enum, not the drizzle storage type', () => {
    it('shares its exact value set with recipe-core’s `recipeVisibilitySchema`', () => {
        // Asserted through behaviour rather than object identity, because the collection body composes
        // recipe-core's `collectionSchema` (which owns the field) rather than referencing the enum directly.
        expect(recipeVisibilitySchema.options).toEqual(['public', 'private']);

        for (const visibility of recipeVisibilitySchema.options) {
            expect(updateCollectionRequestSchema.safeParse({ visibility }).success).toBe(true);
        }
    });
});

describe('drift 4 — the collection body COMPOSES recipe-core rather than re-declaring it', () => {
    it('inherits every key recipe-core’s `collectionSchema` declares, so the two cannot diverge', () => {
        const inherited = Object.keys(collectionSchema.shape);
        const published = Object.keys(collectionResponseSchema.def.innerType.shape);

        expect(published).toEqual(expect.arrayContaining(inherited));
    });

    it('adds EXACTLY the three recipe-service response-only projections and nothing else', () => {
        const inherited = new Set(Object.keys(collectionSchema.shape));
        const added = Object.keys(collectionResponseSchema.def.innerType.shape).filter((key) => !inherited.has(key));

        expect(added.sort()).toEqual(['lastPulledAt', 'sourceCollectionName', 'sourceOwnerHandle']);
    });

    it('recipe-core’s `collectionSchema` DOES own `visibility` and `recipeCount` — the stale comment claiming otherwise is gone', () => {
        expect(collectionSchema.shape).toHaveProperty('visibility');
        expect(collectionSchema.shape).toHaveProperty('recipeCount');
    });
});
