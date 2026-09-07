/**
 * T127-test — unit tests for {@link CollectionsService.cloneCollection} (FR-011).
 *
 * Written BEFORE the implementation (TDD red → green). Pins the clone contract:
 *   1. **Public-only source** — a private collection is not clonable (FR-011 clones a *public*
 *      collection; FR-010 makes private the default).
 *   2. **Owner reassignment** — the clone belongs to the CLONER, never the source's owner.
 *   3. **Provenance** — the clone row carries `source_collection_id`, and every seeded membership is
 *      written with `added_via = 'clone_seed'` (never `manual`), so a later pull can tell what it
 *      seeded from what the cloner added.
 *   4. **Access-scoped snapshot** — the seed set is exactly what the CLONER may see. Private recipes
 *      the cloner cannot access are excluded, which the DAL's `listRecipes(sourceId, viewerId)`
 *      already enforces (`visibility = 'public' OR owner_id = viewer`), so the service must pass the
 *      CLONER as the viewer — passing the source owner would leak that owner's private recipes.
 *
 * Snapshot-ness itself (no automatic propagation) is a property of NOT wiring any listener: there is
 * no code path from a source edit to a clone. The pull spec covers the opt-in reconciliation.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { AuthorHandlesDal } from '../../authors/dal/authorHandles.dal.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../__fixtures__/collections.fixtures.js';

type DalMock = {
    [K in keyof CollectionsDal]: ReturnType<typeof vi.fn>;
};

type AuthorHandlesMock = {
    [K in keyof AuthorHandlesDal]: ReturnType<typeof vi.fn>;
};

/** The stub tx handle `transaction`'s mock hands `fn` — an opaque sentinel, asserted on by identity. */
const FAKE_TX = Symbol('fake-tx');

function makeDal(): DalMock {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        countByOwner: vi.fn(),
        // Not exercised by cloneCollection (only `createCollection` calls this).
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
        // S-R1: runs `fn` against FAKE_TX, mirroring the real DAL's `db.transaction(fn)` — so
        // `cloneCollection`'s `create`/`addRecipes` calls inside the callback actually execute.
        transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(FAKE_TX)),
    };
}

/** Defaults `findHandle` to `undefined` (no resolvable handle) — the common case across the pre-W5-Task-2 tests. */
function makeAuthorHandlesDal(overrides: Partial<AuthorHandlesMock> = {}): AuthorHandlesMock {
    return {
        findHandle: vi.fn().mockResolvedValue(undefined),
        applyRename: vi.fn(),
        ...overrides,
    };
}

function makeService(dal: DalMock, authorHandles: AuthorHandlesMock = makeAuthorHandlesDal()): CollectionsService {
    return new CollectionsService(
        dal as unknown as CollectionsDal,
        authorHandles as unknown as AuthorHandlesDal,
        { capture: vi.fn() } as unknown as AnalyticsService,
    );
}

/** The user performing the clone (NOT the source's owner). */
const CLONER = 'cloner-1';
const SOURCE_OWNER = 'owner-1';
const SOURCE_ID = '00000000-0000-4000-8000-0000000000c1';
const CLONE_ID = '00000000-0000-4000-8000-0000000000c2';

/** A public source collection owned by someone else. */
function publicSource(): ReturnType<typeof makeCollectionRow> {
    return makeCollectionRow({ id: SOURCE_ID, ownerId: SOURCE_OWNER, visibility: 'public', name: 'Sunday Roasts' });
}

describe('CollectionsService.cloneCollection', () => {
    it('creates a collection owned by the CLONER carrying source_collection_id provenance', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(publicSource());
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, name: 'Sunday Roasts', sourceCollectionId: SOURCE_ID }),
        );
        const service = makeService(dal);

        const result = await service.cloneCollection(CLONER, SOURCE_ID);

        // S-R1: `create` runs INSIDE the Unit-of-Work `transaction` opened — the tx handle it receives is
        // the very one `dal.transaction` handed the callback.
        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerId: CLONER,
                name: 'Sunday Roasts',
                sourceCollectionId: SOURCE_ID,
            }),
            FAKE_TX,
        );
        // A clone is the cloner's own collection — private by default (FR-010), never auto-public.
        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }), FAKE_TX);
        expect(result.ownerId).toBe(CLONER);
        expect(result.ownerId).not.toBe(SOURCE_OWNER);
    });

    it("seeds the snapshot from the CLONER's view of the source, marking each membership clone_seed", async () => {
        const dal = makeDal();
        const visibleA = makeRecipeRow({ id: 'rec-a', ownerId: SOURCE_OWNER, visibility: 'public' });
        const visibleB = makeRecipeRow({ id: 'rec-b', ownerId: SOURCE_OWNER, visibility: 'public' });
        dal.findById.mockResolvedValue(publicSource());
        dal.listRecipes.mockResolvedValue([visibleA, visibleB]);
        dal.create.mockResolvedValue(
            makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, sourceCollectionId: SOURCE_ID }),
        );
        dal.addRecipes.mockResolvedValue([
            makeMembershipRow({ collectionId: CLONE_ID, recipeId: 'rec-a', addedVia: 'clone_seed' }),
            makeMembershipRow({ collectionId: CLONE_ID, recipeId: 'rec-b', addedVia: 'clone_seed' }),
        ]);
        const service = makeService(dal);

        await service.cloneCollection(CLONER, SOURCE_ID);

        // The viewer passed to listRecipes MUST be the cloner: the DAL scopes the read to
        // `public OR owner_id = viewer`, so passing SOURCE_OWNER here would seed the clone with the
        // source owner's PRIVATE recipes — an access leak FR-011 forbids.
        expect(dal.listRecipes).toHaveBeenCalledWith(SOURCE_ID, CLONER);
        // S-R1: ONE bulk call carrying every seeded id, not a per-recipe loop (kills the N+1 too).
        expect(dal.addRecipes).toHaveBeenCalledExactlyOnceWith(CLONE_ID, ['rec-a', 'rec-b'], 'clone_seed', FAKE_TX);
    });

    it('refuses to clone a PRIVATE collection (404 — a private collection is not discoverable)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(
            makeCollectionRow({ id: SOURCE_ID, ownerId: SOURCE_OWNER, visibility: 'private' }),
        );
        const service = makeService(dal);

        await expect(service.cloneCollection(CLONER, SOURCE_ID)).rejects.toBeInstanceOf(NotFoundException);
        // Nothing is created and nothing is read from a collection the cloner may not see.
        expect(dal.create).not.toHaveBeenCalled();
        expect(dal.listRecipes).not.toHaveBeenCalled();
    });

    it('lets an owner clone their OWN private collection (they can already see it)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(
            makeCollectionRow({ id: SOURCE_ID, ownerId: SOURCE_OWNER, visibility: 'private' }),
        );
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({ id: CLONE_ID, ownerId: SOURCE_OWNER, sourceCollectionId: SOURCE_ID }),
        );
        const service = makeService(dal);

        const result = await service.cloneCollection(SOURCE_OWNER, SOURCE_ID);

        expect(result.sourceCollectionId).toBe(SOURCE_ID);
    });

    it('404s when the source collection does not exist', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(undefined);
        const service = makeService(dal);

        await expect(service.cloneCollection(CLONER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('creates an EMPTY clone when the cloner can see none of the source recipes', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(publicSource());
        // A public collection whose recipes have all since gone private: the DAL's viewer-scoped read
        // returns nothing, so the clone is empty rather than leaking or failing.
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, sourceCollectionId: SOURCE_ID }),
        );
        const service = makeService(dal);

        const result = await service.cloneCollection(CLONER, SOURCE_ID);

        // Still called (so the DAL's own empty-array no-op is what prevents any SQL, not a service-level
        // branch) — but with an EMPTY id list, so zero membership rows are ever written.
        expect(dal.addRecipes).toHaveBeenCalledExactlyOnceWith(CLONE_ID, [], 'clone_seed', FAKE_TX);
        expect(result.id).toBe(CLONE_ID);
    });

    it('reports a clone of a clone against the collection it was cloned FROM (one hop, not the root)', async () => {
        const dal = makeDal();
        // Provenance is a single hop: cloning a clone points at that clone, not its ancestor. Chasing
        // the chain to a root would misattribute, and the column is ON DELETE SET NULL anyway.
        const sourceIsItselfAClone = makeCollectionRow({
            id: SOURCE_ID,
            ownerId: SOURCE_OWNER,
            visibility: 'public',
            sourceCollectionId: '00000000-0000-4000-8000-0000000000c0',
        });
        dal.findById.mockResolvedValue(sourceIsItselfAClone);
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, sourceCollectionId: SOURCE_ID }),
        );
        const service = makeService(dal);

        await service.cloneCollection(CLONER, SOURCE_ID);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ sourceCollectionId: SOURCE_ID }), FAKE_TX);
    });

    it('surfaces a domain error rather than a raw throw when the source id is malformed', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(undefined);
        const service = makeService(dal);

        const error = await service.cloneCollection(CLONER, 'not-a-uuid').then(
            () => undefined,
            (e: unknown) => e,
        );

        expect(isRecipeDomainError(error) || error instanceof NotFoundException).toBe(true);

        if (isRecipeDomainError(error)) {
            expect(error.code).toBe(RecipeErrorCode.RECIPE_NOT_FOUND);
        }
    });
});

describe('CollectionsService.cloneCollection — source attribution (W5 Task 2, CR-003 frozen-at-clone)', () => {
    /** A public source owned by `SOURCE_OWNER`, named for the attribution assertions below. */
    function attributionSource(): ReturnType<typeof makeCollectionRow> {
        return makeCollectionRow({
            id: SOURCE_ID,
            ownerId: SOURCE_OWNER,
            visibility: 'public',
            name: 'Keto Staples',
        });
    }

    it("resolves the source owner's CURRENT handle via AuthorHandlesDal and freezes it + the source name onto the clone", async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(attributionSource());
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({
                id: CLONE_ID,
                ownerId: CLONER,
                name: 'Keto Staples',
                sourceCollectionId: SOURCE_ID,
                sourceOwnerHandle: 'clara',
                sourceCollectionName: 'Keto Staples',
            }),
        );
        const authorHandles = makeAuthorHandlesDal({ findHandle: vi.fn().mockResolvedValue('clara') });
        const service = makeService(dal, authorHandles);

        const result = await service.cloneCollection(CLONER, SOURCE_ID);

        // Resolved for the SOURCE owner, not the cloner.
        expect(authorHandles.findHandle).toHaveBeenCalledWith(SOURCE_OWNER);
        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({ sourceOwnerHandle: 'clara', sourceCollectionName: 'Keto Staples' }),
            FAKE_TX,
        );
        expect(result.sourceOwnerHandle).toBe('clara');
        expect(result.sourceCollectionName).toBe('Keto Staples');
        expect(result.sourceCollectionId).toBe(SOURCE_ID);
    });

    it('degrades to name-only attribution when the source owner has no resolvable handle yet', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(attributionSource());
        dal.listRecipes.mockResolvedValue([]);
        dal.create.mockResolvedValue(
            makeCollectionRow({
                id: CLONE_ID,
                ownerId: CLONER,
                name: 'Keto Staples',
                sourceCollectionId: SOURCE_ID,
                sourceOwnerHandle: null,
                sourceCollectionName: 'Keto Staples',
            }),
        );
        const authorHandles = makeAuthorHandlesDal({ findHandle: vi.fn().mockResolvedValue(undefined) });
        const service = makeService(dal, authorHandles);

        const result = await service.cloneCollection(CLONER, SOURCE_ID);

        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({ sourceOwnerHandle: null, sourceCollectionName: 'Keto Staples' }),
            FAKE_TX,
        );
        // Omitted (not `null`) on the wire — the omit-null DTO convention (mirrors `sourceCollectionId`).
        expect(result.sourceOwnerHandle).toBeUndefined();
        expect(result.sourceCollectionName).toBe('Keto Staples');
    });
});
