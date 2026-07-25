/**
 * T040-test — unit tests for {@link CollectionsService} over a mocked {@link CollectionsDal}.
 *
 * Pins the pure service behaviour: row→wire mapping (ISO dates, nulls→absent), pagination envelope,
 * ownership enforcement (missing → 404 `NotFoundException`; other owner → NOT_OWNER 403), the
 * no-cascade delete, membership add validation (RECIPE_NOT_FOUND), and tombstone-excluded recipe
 * listing (via the DAL). Real DB semantics live in the integration spec.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { AuthorHandlesDal } from '../../authors/dal/author-handles.dal.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../__fixtures__/collections.fixtures.js';

type DalMock = {
    [K in keyof CollectionsDal]: ReturnType<typeof vi.fn>;
};

function makeDal(): DalMock {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        // Defaults to "no existing collections" so tests exercising createCollection's happy path do not
        // need to stub the REQ-049b cap check explicitly.
        countByOwner: vi.fn().mockResolvedValue(0),
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
        // Not exercised outside `cloneCollection`/`pullFromSource` here — runs `fn` against a stub tx.
        transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    };
}

/** Not exercised outside `cloneCollection` here — a stub resolving to `undefined` is sufficient. */
function makeAuthorHandlesDal(): { [K in keyof AuthorHandlesDal]: ReturnType<typeof vi.fn> } {
    return { findHandle: vi.fn().mockResolvedValue(undefined), applyRename: vi.fn() };
}

function makeService(dal: DalMock): CollectionsService {
    return new CollectionsService(
        dal as unknown as CollectionsDal,
        makeAuthorHandlesDal() as unknown as AuthorHandlesDal,
    );
}

const OWNER = 'owner-1';

describe('CollectionsService.createCollection', () => {
    it('defaults visibility to private and maps the row to the wire shape', async () => {
        const dal = makeDal();
        const row = makeCollectionRow();
        dal.create.mockResolvedValue(row);
        const service = makeService(dal);

        const result = await service.createCollection(OWNER, { name: 'Weeknight Dinners' });

        expect(dal.create).toHaveBeenCalledWith({
            ownerId: OWNER,
            name: 'Weeknight Dinners',
            description: undefined,
            visibility: 'private',
        });
        expect(result).toEqual({
            id: row.id,
            ownerId: OWNER,
            name: 'Weeknight Dinners',
            visibility: 'private',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });
        expect(result).not.toHaveProperty('description');
        expect(result).not.toHaveProperty('recipeCount');
    });

    it('passes through an explicit public visibility and description', async () => {
        const dal = makeDal();
        dal.create.mockResolvedValue(makeCollectionRow({ description: 'Fast meals', visibility: 'public' }));
        const service = makeService(dal);

        const result = await service.createCollection(OWNER, {
            name: 'Weeknight Dinners',
            description: 'Fast meals',
            visibility: 'public',
        });

        expect(result.visibility).toBe('public');
        expect(result.description).toBe('Fast meals');
    });
});

describe('CollectionsService.createCollection — 50-collection-per-owner cap (REQ-049b)', () => {
    it('creates the 50th collection (count already at 49, still under the cap)', async () => {
        const dal = makeDal();
        dal.countByOwner.mockResolvedValue(49);
        dal.create.mockResolvedValue(makeCollectionRow());
        const service = makeService(dal);

        await service.createCollection(OWNER, { name: 'Fiftieth' });

        expect(dal.create).toHaveBeenCalledTimes(1);
    });

    it('rejects the 51st collection with COLLECTION_LIMIT_REACHED, without writing anything', async () => {
        const dal = makeDal();
        dal.countByOwner.mockResolvedValue(50);
        const service = makeService(dal);

        await expect(service.createCollection(OWNER, { name: 'Fifty-first' })).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.COLLECTION_LIMIT_REACHED,
        );
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('also rejects when the count is already past the cap (defense in depth)', async () => {
        const dal = makeDal();
        dal.countByOwner.mockResolvedValue(51);
        const service = makeService(dal);

        await expect(service.createCollection(OWNER, { name: 'Way over' })).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.COLLECTION_LIMIT_REACHED,
        );
        expect(dal.create).not.toHaveBeenCalled();
    });

    it("counts the CALLING owner's collections, not a hardcoded/other owner", async () => {
        const dal = makeDal();
        dal.countByOwner.mockResolvedValue(0);
        dal.create.mockResolvedValue(makeCollectionRow());
        const service = makeService(dal);

        await service.createCollection(OWNER, { name: 'X' });

        expect(dal.countByOwner).toHaveBeenCalledWith(OWNER);
        expect(dal.countByOwner).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionsService.listCollections', () => {
    it('builds a paginated envelope with limit/offset and hasMore', async () => {
        const dal = makeDal();
        const rows = [makeCollectionRow({ id: 'a' }), makeCollectionRow({ id: 'b' })];
        dal.listByOwner.mockResolvedValue({ rows, total: 5 });
        const service = makeService(dal);

        const result = await service.listCollections(OWNER, { page: 1, pageSize: 2 });

        expect(dal.listByOwner).toHaveBeenCalledWith(OWNER, 2, 0);
        expect(result.total).toBe(5);
        expect(result.page).toBe(1);
        expect(result.pageSize).toBe(2);
        expect(result.data).toHaveLength(2);
        expect(result.hasMore).toBe(true);
    });

    it('reports hasMore=false on the last page', async () => {
        const dal = makeDal();
        dal.listByOwner.mockResolvedValue({ rows: [makeCollectionRow()], total: 5 });
        const service = makeService(dal);

        const result = await service.listCollections(OWNER, { page: 3, pageSize: 2 });

        expect(dal.listByOwner).toHaveBeenCalledWith(OWNER, 2, 4);
        expect(result.hasMore).toBe(false);
    });
});

describe('CollectionsService.getCollection', () => {
    it('returns the collection with its recipes and a recipeCount', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.listRecipes.mockResolvedValue([makeRecipeRow({ id: 'r1' }), makeRecipeRow({ id: 'r2' })]);
        const service = makeService(dal);

        const result = await service.getCollection(OWNER, 'c1');

        expect(result.recipeCount).toBe(2);
        expect(result.recipes).toHaveLength(2);
        expect(result.recipes[0]?.id).toBe('r1');
        expect(result.recipes[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
        // The caller is passed as the VIEWER so the DAL can filter out other users' private recipes
        // (membership-IDOR guard). Dropping the viewer arg would list every member regardless of owner.
        expect(dal.listRecipes).toHaveBeenCalledWith('c1', OWNER);
    });

    it('throws NotFoundException when the collection is missing', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(undefined);
        const service = makeService(dal);

        await expect(service.getCollection(OWNER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NOT_OWNER when the collection belongs to another user', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: 'someone-else' }));
        const service = makeService(dal);

        await expect(service.getCollection(OWNER, 'c1')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.NOT_OWNER,
        );
    });

    // W5 Task 4: the source-indicator checkbox (C3) needs each member's provenance on the embed.
    it("carries each member's addedVia through from the DAL row onto the embedded recipe", async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.listRecipes.mockResolvedValue([
            { ...makeRecipeRow({ id: 'r-manual' }), addedVia: 'manual' },
            { ...makeRecipeRow({ id: 'r-clone' }), addedVia: 'clone_seed' },
            { ...makeRecipeRow({ id: 'r-pull' }), addedVia: 'pull' },
        ]);
        const service = makeService(dal);

        const result = await service.getCollection(OWNER, 'c1');

        expect(result.recipes.map((recipe) => ({ id: recipe.id, addedVia: recipe.addedVia }))).toEqual([
            { id: 'r-manual', addedVia: 'manual' },
            { id: 'r-clone', addedVia: 'clone_seed' },
            { id: 'r-pull', addedVia: 'pull' },
        ]);
    });

    // Leak-matrix re-assertion (predicate untouched, W5 Task 4): the embed must render EXACTLY what the
    // DAL's viewer-scoped `listRecipes` returned — never more. The real filtering (a non-owner's
    // public-draft/private/deleted member dropping out) lives in `membershipPredicate`
    // (activeRecipe/viewableBy/publishedOrOwnedBy, untouched by this change) and is proven against a real
    // DB in the integration spec; this unit test pins that the service layer adds no members of its own
    // and forwards the correct viewer id, so a service-side leak (e.g. re-querying unscoped) would fail it.
    it('renders exactly the members the DAL returned (no service-side widening) and scopes by viewer', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.listRecipes.mockResolvedValue([{ ...makeRecipeRow({ id: 'visible-only' }), addedVia: 'manual' }]);
        const service = makeService(dal);

        const result = await service.getCollection(OWNER, 'c1');

        expect(result.recipes).toHaveLength(1);
        expect(result.recipes[0]?.id).toBe('visible-only');
        expect(dal.listRecipes).toHaveBeenCalledWith('c1', OWNER);
        expect(dal.listRecipes).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionsService.deleteCollection (no-cascade)', () => {
    it('deletes only the collection after an ownership check', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.deleteById.mockResolvedValue(true);
        const service = makeService(dal);

        await service.deleteCollection(OWNER, 'c1');

        expect(dal.findById).toHaveBeenCalledWith('c1');
        expect(dal.deleteById).toHaveBeenCalledWith('c1');
        // No-cascade: the service never touches recipe rows when deleting a collection.
        expect(dal.removeRecipe).not.toHaveBeenCalled();
        expect(dal.listRecipes).not.toHaveBeenCalled();
    });

    it('refuses to delete a collection owned by someone else', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: 'someone-else' }));
        const service = makeService(dal);

        await expect(service.deleteCollection(OWNER, 'c1')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.NOT_OWNER,
        );
        expect(dal.deleteById).not.toHaveBeenCalled();
    });
});

describe('CollectionsService.addRecipe', () => {
    it('adds an active recipe to an owned collection', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.findActiveRecipe.mockResolvedValue(makeRecipeRow({ id: 'r1' }));
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'r1' }));
        const service = makeService(dal);

        const result = await service.addRecipe(OWNER, 'c1', 'r1');

        expect(dal.addRecipe).toHaveBeenCalledWith('c1', 'r1', 'manual');
        expect(result).toEqual({
            collectionId: '00000000-0000-4000-8000-0000000000c1',
            recipeId: 'r1',
            addedVia: 'manual',
            createdAt: '2026-01-01T00:00:00.000Z',
        });
    });

    it('throws RECIPE_NOT_FOUND for a missing/tombstoned recipe', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.findActiveRecipe.mockResolvedValue(undefined);
        const service = makeService(dal);

        await expect(service.addRecipe(OWNER, 'c1', 'gone')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.RECIPE_NOT_FOUND,
        );
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });

    // Membership-IDOR guard (ADV-4): a caller must not add another user's PRIVATE recipe to their own
    // collection — doing so and then reading the collection back would exfiltrate the private body.
    // Reported as RECIPE_NOT_FOUND (not 403) so the private recipe's existence is never disclosed.
    // Removing the `isRecipeViewableBy` check lets the add through and fails this test.
    it("refuses to add another user's PRIVATE recipe (RECIPE_NOT_FOUND, no membership written)", async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.findActiveRecipe.mockResolvedValue(
            makeRecipeRow({ id: 'r1', ownerId: 'someone-else', visibility: 'private' }),
        );
        const service = makeService(dal);

        await expect(service.addRecipe(OWNER, 'c1', 'r1')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.RECIPE_NOT_FOUND,
        );
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });

    it("adds another user's PUBLIC recipe (viewable → allowed)", async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.findActiveRecipe.mockResolvedValue(
            makeRecipeRow({ id: 'r1', ownerId: 'someone-else', visibility: 'public' }),
        );
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'r1' }));
        const service = makeService(dal);

        await service.addRecipe(OWNER, 'c1', 'r1');

        expect(dal.addRecipe).toHaveBeenCalledWith('c1', 'r1', 'manual');
    });

    it("adds the caller's OWN private recipe (owner always views their own)", async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.findActiveRecipe.mockResolvedValue(makeRecipeRow({ id: 'r1', ownerId: OWNER, visibility: 'private' }));
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'r1' }));
        const service = makeService(dal);

        await service.addRecipe(OWNER, 'c1', 'r1');

        expect(dal.addRecipe).toHaveBeenCalledWith('c1', 'r1', 'manual');
    });
});

describe('CollectionsService.removeRecipe', () => {
    it('removes the membership from an owned collection', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.removeRecipe.mockResolvedValue(true);
        const service = makeService(dal);

        await service.removeRecipe(OWNER, 'c1', 'r1');

        expect(dal.removeRecipe).toHaveBeenCalledWith('c1', 'r1');
    });
});

describe('CollectionsService.updateCollection', () => {
    let dal: DalMock;

    beforeEach(() => {
        dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
    });

    it('updates name/description on an owned collection', async () => {
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, name: 'Renamed' }));
        const service = makeService(dal);

        const result = await service.updateCollection(OWNER, 'c1', { name: 'Renamed' });

        expect(dal.update).toHaveBeenCalledWith('c1', { name: 'Renamed' });
        expect(result.name).toBe('Renamed');
    });
});
