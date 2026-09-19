/**
 * ADR-0040 — test-principal CONTAINMENT at the collections decision points, over a mocked DAL.
 *
 * A public collection enters community discovery; a clone of another user's collection ties a test row into that
 * user's erasure provenance (their erasure rewrites the clone's frozen source handle); a save of a recipe is an
 * impact signal that never decrements. On an enforcing stage a signed test principal may do none of those, and may
 * still do everything owner-scoped. Where containment is `off` nothing changes.
 *
 * The collaborator doubles record every call, so a refusal only passes if nothing was written.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import type { AuthorHandlesDal } from '../../authors/dal/authorHandles.dal.js';
import type { AnalyticsService } from '../../analytics/analytics.service.js';
import { makeActingPrincipal } from '../../auth/__fixtures__/actingPrincipal.fixtures.js';
import { makeCollectionRow, makeMembershipRow, makeRecipeRow } from '../__fixtures__/collections.fixtures.js';

const TEST_PRINCIPAL = '01JZCONTAINEDTESTPRINCIPAL';
const REAL_USER = '01JZREALUSERWHOOWNSTHINGS0';
const CONTAINED = makeActingPrincipal(TEST_PRINCIPAL, { principalKind: 'test', containment: 'enforce' });
const UNCONTAINED = makeActingPrincipal(TEST_PRINCIPAL, { principalKind: 'test', containment: 'off' });

type DalMock = { [K in keyof CollectionsDal]: ReturnType<typeof vi.fn> };

function harness() {
    const dal = {
        create: vi
            .fn()
            .mockImplementation(async (input: { ownerId: string; visibility: string }) =>
                makeCollectionRow({ ownerId: input.ownerId, visibility: input.visibility }),
            ),
        findById: vi.fn(),
        listByOwner: vi.fn(),
        countByOwner: vi.fn(),
        createIfUnderCap: vi
            .fn()
            .mockImplementation(async (input: { ownerId: string; visibility: string }) =>
                makeCollectionRow({ ownerId: input.ownerId, visibility: input.visibility }),
            ),
        update: vi.fn().mockResolvedValue(makeCollectionRow({ ownerId: TEST_PRINCIPAL })),
        deleteById: vi.fn(),
        findActiveRecipe: vi
            .fn()
            .mockResolvedValue(makeRecipeRow({ id: 'r1', ownerId: REAL_USER, visibility: 'public' })),
        addRecipe: vi.fn().mockResolvedValue({ row: makeMembershipRow({ recipeId: 'r1' }), created: true }),
        addRecipes: vi.fn(),
        findMembership: vi.fn(),
        removeRecipe: vi.fn(),
        listRecipes: vi.fn().mockResolvedValue([]),
        previewMembershipIds: vi.fn(),
        touchLastPulled: vi.fn(),
        transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    } satisfies DalMock;
    const analytics = { capture: vi.fn() };
    const service = new CollectionsService(
        dal as unknown as CollectionsDal,
        { findHandle: vi.fn().mockResolvedValue(undefined), applyRename: vi.fn() } as unknown as AuthorHandlesDal,
        analytics as unknown as AnalyticsService,
    );

    return { dal, analytics, service };
}

/** Resolve a promise's rejection, or fail the test if it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => expect.unreachable('expected a containment refusal'),
        (error: unknown) => error,
    );
}

/** Assert the refusal is the published containment 403. */
function expectContained(error: unknown): void {
    expect(error instanceof HttpException && error.getStatus()).toBe(403);
    expect(error instanceof HttpException && (error.getResponse() as { code: string }).code).toBe(
        'TEST_PRINCIPAL_CONTAINED',
    );
}

describe('CollectionsService — publishing a collection (ADR-0040)', () => {
    it('⛔ refuses a contained test principal’s PUBLIC create, before any write', async () => {
        const { dal, service } = harness();

        expectContained(await rejectionOf(service.createCollection(CONTAINED, { name: 'Leak', visibility: 'public' })));
        expect(dal.createIfUnderCap).not.toHaveBeenCalled();
    });

    it('lets a contained test principal create a PRIVATE collection, including by default', async () => {
        const { service } = harness();

        expect((await service.createCollection(CONTAINED, { name: 'Mine' })).visibility).toBe('private');
    });

    it('⛔ refuses a contained test principal’s flip to PUBLIC through update AND through setVisibility', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: TEST_PRINCIPAL, visibility: 'private' }));

        expectContained(await rejectionOf(service.updateCollection(CONTAINED, 'c1', { visibility: 'public' })));
        expectContained(await rejectionOf(service.setVisibility(CONTAINED, 'c1', 'public')));
        expect(dal.update).not.toHaveBeenCalled();
    });

    it('lets a contained test principal rename a collection — a patch with no visibility publishes nothing', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: TEST_PRINCIPAL }));

        await service.updateCollection(CONTAINED, 'c1', { name: 'Renamed' });

        expect(dal.update).toHaveBeenCalledOnce();
    });

    it('lets a test principal publish where containment is off', async () => {
        const { service } = harness();

        expect((await service.createCollection(UNCONTAINED, { name: 'Shared', visibility: 'public' })).visibility).toBe(
            'public',
        );
    });
});

describe('CollectionsService.cloneCollection (ADR-0040)', () => {
    it('⛔ refuses a contained test principal’s clone of ANOTHER user’s public collection, before any write', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: REAL_USER, visibility: 'public' }));

        expectContained(await rejectionOf(service.cloneCollection(CONTAINED, 'src')));
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('⛔ still 404s another user’s PRIVATE collection — containment never reveals existence', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: REAL_USER, visibility: 'private' }));

        const error = await rejectionOf(service.cloneCollection(CONTAINED, 'src'));

        expect(error instanceof HttpException && error.getStatus()).toBe(404);
    });

    it('lets a contained test principal clone its OWN collection', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: TEST_PRINCIPAL, visibility: 'private' }));

        await service.cloneCollection(CONTAINED, 'src');

        expect(dal.create).toHaveBeenCalledOnce();
    });

    it('lets a test principal clone a foreign public collection where containment is off', async () => {
        const { dal, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: REAL_USER, visibility: 'public' }));

        await service.cloneCollection(UNCONTAINED, 'src');

        expect(dal.create).toHaveBeenCalledOnce();
    });
});

describe('CollectionsService.addRecipe — the save capture carries the actor (ADR-0040)', () => {
    it('hands the analytics seam the ACTING principal, so containment is decided where every capture converges', async () => {
        const { dal, analytics, service } = harness();
        dal.findById.mockResolvedValue(makeCollectionRow({ ownerId: TEST_PRINCIPAL }));

        await service.addRecipe(CONTAINED, 'c1', 'r1');

        expect(analytics.capture).toHaveBeenCalledWith({ type: 'recipe_saved', actor: CONTAINED, recipeId: 'r1' });
    });
});
