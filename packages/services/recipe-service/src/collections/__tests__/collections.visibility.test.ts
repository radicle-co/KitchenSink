/**
 * T140-test — the set-collection-visibility behaviour (FR-010) on {@link CollectionsService}.
 *
 * A `public`↔`private` toggle that is ownership-enforced and rejects any value outside the allowed set
 * as INVALID_VISIBILITY (→ 400), enforced in the SERVICE (not merely at the controller edge). Covers
 * both the dedicated `setVisibility` method and `updateCollection` carrying a `visibility` patch.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import type { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import { isCollectionError } from '../collections.errors.js';
import { makeCollectionRow } from '../__fixtures__/collections.fixtures.js';

type DalMock = { [K in keyof CollectionsDal]: ReturnType<typeof vi.fn> };

function makeDal(overrides: Partial<DalMock> = {}): DalMock {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        update: vi.fn(),
        deleteById: vi.fn(),
        findActiveRecipe: vi.fn(),
        addRecipe: vi.fn(),
        findMembership: vi.fn(),
        removeRecipe: vi.fn(),
        listRecipes: vi.fn(),
        ...overrides,
    };
}

const OWNER = 'owner-1';

describe('CollectionsService.setVisibility (FR-010 / T140)', () => {
    it.each(['public', 'private'] as const)('toggles an owned collection to %s', async (visibility) => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility }));
        const service = new CollectionsService(dal as unknown as CollectionsDal);

        const result = await service.setVisibility(OWNER, 'c1', visibility);

        expect(dal.update).toHaveBeenCalledWith('c1', { visibility });
        expect(result.visibility).toBe(visibility);
    });

    it('rejects an invalid visibility with INVALID_VISIBILITY before any DB write', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        const service = new CollectionsService(dal as unknown as CollectionsDal);

        await expect(service.setVisibility(OWNER, 'c1', 'unlisted')).rejects.toSatisfy(
            (err: unknown) => isCollectionError(err) && err.code === RecipeErrorCode.INVALID_VISIBILITY,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('enforces ownership — a non-owner cannot change visibility', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: 'someone-else' }));
        const service = new CollectionsService(dal as unknown as CollectionsDal);

        await expect(service.setVisibility(OWNER, 'c1', 'public')).rejects.toSatisfy(
            (err: unknown) => isCollectionError(err) && err.code === RecipeErrorCode.NOT_OWNER,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });
});

describe('CollectionsService.updateCollection with a visibility patch', () => {
    it('rejects an invalid visibility in the patch (service is the enforcement point)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        const service = new CollectionsService(dal as unknown as CollectionsDal);

        await expect(service.updateCollection(OWNER, 'c1', { visibility: 'bogus' })).rejects.toSatisfy(
            (err: unknown) => isCollectionError(err) && err.code === RecipeErrorCode.INVALID_VISIBILITY,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('accepts a valid visibility patch on an owned collection', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'public' }));
        const service = new CollectionsService(dal as unknown as CollectionsDal);

        const result = await service.updateCollection(OWNER, 'c1', { visibility: 'public' });

        expect(result.visibility).toBe('public');
    });
});
