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
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { AuthorHandlesDal } from '../../authors/dal/authorHandles.dal.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import { makeCollectionRow } from '../__fixtures__/collections.fixtures.js';
import type { UpdateCollectionRequest } from '../collections.schema.js';
import { makeCollectionsActor } from '../../auth/__fixtures__/actingPrincipal.fixtures.js';

type DalMock = { [K in keyof CollectionsDal]: ReturnType<typeof vi.fn> };

function makeDal(overrides: Partial<DalMock> = {}): DalMock {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        countByOwner: vi.fn().mockResolvedValue(0),
        // Not exercised by visibility toggles (only `createCollection` calls this).
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
        memberSummaries: vi.fn().mockResolvedValue(new Map()),
        sourceOwnerUsernames: vi.fn().mockResolvedValue(new Map()),
        touchLastPulled: vi.fn(),
        // Not exercised by visibility toggles — runs `fn` against a stub tx.
        transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
        ...overrides,
    };
}

/** Visibility toggles never touch `AuthorHandlesDal` — a stub resolving to `undefined` is sufficient. */
function makeAuthorHandlesDal(): AuthorHandlesDal {
    return { findByline: vi.fn().mockResolvedValue(undefined) } as unknown as AuthorHandlesDal;
}

const OWNER = 'owner-1';

describe('CollectionsService.setVisibility (FR-010 / T140)', () => {
    it.each(['public', 'private'] as const)('toggles an owned collection to %s', async (visibility) => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility }));
        const service = new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            {
                capture: vi.fn(),
            } as unknown as AnalyticsService,
            'https://cdn.test',
        );

        const result = await service.setVisibility(makeCollectionsActor(OWNER), 'c1', visibility);

        expect(dal.update).toHaveBeenCalledWith('c1', { visibility });
        expect(result.visibility).toBe(visibility);
    });

    it('rejects an invalid visibility with INVALID_VISIBILITY before any DB write', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        const service = new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            {
                capture: vi.fn(),
            } as unknown as AnalyticsService,
            'https://cdn.test',
        );

        await expect(service.setVisibility(makeCollectionsActor(OWNER), 'c1', 'unlisted')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.INVALID_VISIBILITY,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('enforces ownership — a non-owner cannot change visibility', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: 'someone-else' }));
        const service = new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            {
                capture: vi.fn(),
            } as unknown as AnalyticsService,
            'https://cdn.test',
        );

        await expect(service.setVisibility(makeCollectionsActor(OWNER), 'c1', 'public')).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.NOT_OWNER,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });
});

describe('CollectionsService.updateCollection with a visibility patch', () => {
    it('rejects an invalid visibility in the patch (service is an INDEPENDENT enforcement point)', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        const service = new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            {
                capture: vi.fn(),
            } as unknown as AnalyticsService,
            'https://cdn.test',
        );

        // The cast is the POINT of this test, not a workaround for it. The wire schema now narrows
        // `visibility` to `'public' | 'private'`, so `'bogus'` cannot arrive through the validation pipe —
        // and that is exactly why the service's own runtime guard must still be proven to fire. This
        // simulates a caller that bypasses the pipe (a direct service call, a future internal path); if the
        // guard were ever deleted as "unreachable", this assertion is what reds the build.
        const bypassesThePipe = { visibility: 'bogus' } as unknown as UpdateCollectionRequest;

        await expect(service.updateCollection(makeCollectionsActor(OWNER), 'c1', bypassesThePipe)).rejects.toSatisfy(
            (err: unknown) => isRecipeDomainError(err) && err.code === RecipeErrorCode.INVALID_VISIBILITY,
        );
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('accepts a valid visibility patch on an owned collection', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'public' }));
        const service = new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            {
                capture: vi.fn(),
            } as unknown as AnalyticsService,
            'https://cdn.test',
        );

        const result = await service.updateCollection(makeCollectionsActor(OWNER), 'c1', { visibility: 'public' });

        expect(result.visibility).toBe('public');
    });
});

/**
 * Owner 2026-10-13: a PRIVATE collection is a Premium feature. The rule itself is the pure
 * `collectionVisibilityPolicy`; these prove the service CONSULTS it on every write path, and writes nothing when it refuses.
 */
describe('CollectionsService — private collections are Premium (owner 2026-10-13)', () => {
    const FREE = makeCollectionsActor(OWNER, { isPremium: false });
    const PREMIUM = makeCollectionsActor(OWNER, { isPremium: true });

    function build(dal: DalMock): CollectionsService {
        return new CollectionsService(
            dal as unknown as CollectionsDal,
            makeAuthorHandlesDal(),
            { capture: vi.fn() } as unknown as AnalyticsService,
            'https://cdn.test',
        );
    }

    const isInvalidVisibility = (err: unknown): boolean =>
        isRecipeDomainError(err) && err.code === RecipeErrorCode.INVALID_VISIBILITY;

    function createDal(): DalMock {
        return makeDal({
            createIfUnderCap: vi
                .fn()
                .mockImplementation(async (input: { ownerId: string; visibility: string }) =>
                    makeCollectionRow({ ownerId: input.ownerId, visibility: input.visibility }),
                ),
        });
    }

    it('creates a free-tier cook’s collection PUBLIC when no visibility is named', async () => {
        const dal = createDal();

        const result = await build(dal).createCollection(FREE, { name: 'Dinners' });

        expect(dal.createIfUnderCap).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'public' }),
            expect.any(Number),
        );
        expect(result.visibility).toBe('public');
    });

    it('creates a premium cook’s collection PRIVATE when no visibility is named (FR-010 default)', async () => {
        const dal = createDal();

        await build(dal).createCollection(PREMIUM, { name: 'Dinners' });

        expect(dal.createIfUnderCap).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'private' }),
            expect.any(Number),
        );
    });

    it('REFUSES a free-tier create that asks for private, and writes nothing', async () => {
        const dal = createDal();

        await expect(build(dal).createCollection(FREE, { name: 'Secret', visibility: 'private' })).rejects.toSatisfy(
            isInvalidVisibility,
        );
        expect(dal.createIfUnderCap).not.toHaveBeenCalled();
    });

    it('lets a free-tier cook create a public collection explicitly', async () => {
        const dal = createDal();

        await build(dal).createCollection(FREE, { name: 'Open', visibility: 'public' });

        expect(dal.createIfUnderCap).toHaveBeenCalledWith(
            expect.objectContaining({ visibility: 'public' }),
            expect.any(Number),
        );
    });

    it('REFUSES a free-tier update that moves a public collection to private, and writes nothing', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'public' }));

        await expect(build(dal).updateCollection(FREE, 'c1', { visibility: 'private' })).rejects.toSatisfy(
            isInvalidVisibility,
        );
        await expect(build(dal).setVisibility(FREE, 'c1', 'private')).rejects.toSatisfy(isInvalidVisibility);
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('keeps a lapsed cook’s already-private collection editable: private to private is not a transition', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'private' }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'private', name: 'Renamed' }));

        await build(dal).updateCollection(FREE, 'c1', { name: 'Renamed', visibility: 'private' });

        expect(dal.update).toHaveBeenCalledTimes(1);
    });

    it('lets a free-tier cook move a private collection to public', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'private' }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'public' }));

        await build(dal).setVisibility(FREE, 'c1', 'public');

        expect(dal.update).toHaveBeenCalledWith('c1', { visibility: 'public' });
    });

    it('lets a premium cook move a collection to private', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'public' }));
        dal.update.mockResolvedValue(makeCollectionRow({ ownerId: OWNER, visibility: 'private' }));

        await build(dal).setVisibility(PREMIUM, 'c1', 'private');

        expect(dal.update).toHaveBeenCalledWith('c1', { visibility: 'private' });
    });
});
