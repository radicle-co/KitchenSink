/**
 * T128-test — unit tests for {@link CollectionsService.pullFromSource} (FR-011).
 *
 * Written BEFORE the implementation (TDD red → green). Pins the opt-in reconciliation contract:
 *   1. **Owner-only, source-required** — only the clone's owner may pull, and a collection with no
 *      `source_collection_id` has nothing to pull FROM (400, not a silent no-op).
 *   2. **Additive** — new source recipes arrive as `added_via = 'pull'`. Recipes the SOURCE OWNER has
 *      since removed from the source are NOT removed from the clone (data-model.md §Clone semantics):
 *      the clone is the cloner's property, and source curation does not reach into it.
 *   3. **Never overwrites the cloner's own additions** (FR-011) — a recipe the cloner added `manual`
 *      that also exists in the source keeps its `manual` provenance.
 *   4. **No-op when nothing is new** — no writes at all, so a pull is cheap and idempotent.
 *
 * On FR-011's "removing recipes the cloner can no longer access": that is NOT this write path's job
 * and is deliberately absent here. `CollectionsDal.listRecipes` filters every membership read by
 * `visibility = 'public' OR owner_id = viewer` (the membership-IDOR guard), so a recipe that goes
 * private disappears from the clone on the NEXT READ — continuously, without waiting for a pull.
 * Physically deleting those rows on pull would be strictly worse: irreversible, and a recipe returning
 * to public could never come back. Retention of the row + read-time filtering satisfies FR-011.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

import type { CollectionsDal } from '../dal/collections.dal.js';
import { CollectionsService } from '../collections.service.js';
import { isRecipeDomainError } from '../../recipes/recipe.error.js';
import type { AuthorHandlesDal } from '../../authors/dal/author-handles.dal.js';
import { makeCollectionRow, makeMembershipRow } from '../__fixtures__/collections.fixtures.js';

type DalMock = {
    [K in keyof CollectionsDal]: ReturnType<typeof vi.fn>;
};

function makeDal(): DalMock {
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
        previewMembershipIds: vi.fn(),
        // Default: a valid row so tests that don't care about `lastPulledAt` specifically (most of the
        // pre-Task-3 cases below) don't have to wire it — `toCollectionResponse` always needs a real row.
        touchLastPulled: vi.fn().mockResolvedValue(makeCollectionRow({ id: CLONE_ID })),
    };
}

/** `pullFromSource` never touches `AuthorHandlesDal` — a stub resolving to `undefined` is sufficient. */
function makeAuthorHandlesDal(): { [K in keyof AuthorHandlesDal]: ReturnType<typeof vi.fn> } {
    return { findHandle: vi.fn().mockResolvedValue(undefined), applyRename: vi.fn() };
}

function makeService(dal: DalMock): CollectionsService {
    return new CollectionsService(
        dal as unknown as CollectionsDal,
        makeAuthorHandlesDal() as unknown as AuthorHandlesDal,
    );
}

const CLONER = 'cloner-1';
const SOURCE_OWNER = 'owner-1';
const SOURCE_ID = '00000000-0000-4000-8000-0000000000c1';
const CLONE_ID = '00000000-0000-4000-8000-0000000000c2';

/** The cloner's clone, pointing at SOURCE_ID. */
function clone(): ReturnType<typeof makeCollectionRow> {
    return makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, sourceCollectionId: SOURCE_ID });
}

/**
 * Wire `findById` per-collection: the clone for CLONE_ID, a public source for SOURCE_ID.
 */
function wireFindById(dal: DalMock, cloneRow = clone()): void {
    dal.findById.mockImplementation(async (id: string) => {
        if (id === CLONE_ID) {
            return cloneRow;
        }

        if (id === SOURCE_ID) {
            return makeCollectionRow({ id: SOURCE_ID, ownerId: SOURCE_OWNER, visibility: 'public' });
        }

        return undefined;
    });
}

/**
 * Wire the coherent read-only membership read the commit + preview use (W8-a.8): the clone's current id set
 * and the source's, viewer-scoped, returned from ONE read-only transaction.
 */
function wireListRecipes(dal: DalMock, cloneRecipes: string[], sourceRecipes: string[]): void {
    dal.previewMembershipIds.mockResolvedValue({ cloneIds: cloneRecipes, sourceIds: sourceRecipes });
}

describe('CollectionsService.pullFromSource', () => {
    it("adds the source's new recipes as added_via='pull'", async () => {
        const dal = makeDal();
        wireFindById(dal);
        // Clone already has rec-a; the source has since gained rec-b.
        wireListRecipes(dal, ['rec-a'], ['rec-a', 'rec-b']);
        dal.addRecipe.mockImplementation(async (collectionId: string, recipeId: string, addedVia: string) =>
            makeMembershipRow({ collectionId, recipeId, addedVia: addedVia as 'pull' }),
        );
        const service = makeService(dal);

        const result = await service.pullFromSource(CLONER, CLONE_ID);

        expect(dal.addRecipe).toHaveBeenCalledExactlyOnceWith(CLONE_ID, 'rec-b', 'pull');
        expect(result.addedRecipeIds).toEqual(['rec-b']);
    });

    it("reads the source through the CLONER's eyes, never the source owner's", async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, [], []);
        const service = makeService(dal);

        await service.pullFromSource(CLONER, CLONE_ID);

        // Same access rule as clone-time: the viewer is the cloner, so a source recipe that is private
        // to SOURCE_OWNER is never pulled into the cloner's collection.
        expect(dal.previewMembershipIds).toHaveBeenCalledWith(CLONE_ID, SOURCE_ID, CLONER);
    });

    it('does NOT remove recipes the source owner has since removed from the source', async () => {
        const dal = makeDal();
        wireFindById(dal);
        // rec-a is in the clone but no longer in the source — the clone keeps it.
        wireListRecipes(dal, ['rec-a'], ['rec-b']);
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'rec-b', addedVia: 'pull' }));
        const service = makeService(dal);

        await service.pullFromSource(CLONER, CLONE_ID);

        // The clone is the cloner's property: source curation must not reach into it.
        expect(dal.removeRecipe).not.toHaveBeenCalled();
    });

    it('never overwrites a recipe the cloner added manually (FR-011)', async () => {
        const dal = makeDal();
        wireFindById(dal);
        // rec-a is in BOTH the clone (added manually by the cloner) and the source.
        wireListRecipes(dal, ['rec-a'], ['rec-a']);
        const service = makeService(dal);

        const result = await service.pullFromSource(CLONER, CLONE_ID);

        // It is already present, so it is not re-added — its `manual` provenance survives untouched.
        expect(dal.addRecipe).not.toHaveBeenCalled();
        expect(result.addedRecipeIds).toEqual([]);
    });

    it('is a no-op (zero writes) when the source has nothing new', async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, ['rec-a', 'rec-b'], ['rec-a', 'rec-b']);
        const service = makeService(dal);

        const result = await service.pullFromSource(CLONER, CLONE_ID);

        expect(dal.addRecipe).not.toHaveBeenCalled();
        expect(dal.removeRecipe).not.toHaveBeenCalled();
        expect(result.addedRecipeIds).toEqual([]);
    });

    it('W5 Task 3: stamps lastPulledAt on a pull that adds a new recipe, and surfaces it on the response', async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, ['rec-a'], ['rec-a', 'rec-b']);
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'rec-b', addedVia: 'pull' }));
        const touchedAt = new Date('2026-07-24T12:00:00.000Z');
        dal.touchLastPulled.mockResolvedValue(
            makeCollectionRow({
                id: CLONE_ID,
                ownerId: CLONER,
                sourceCollectionId: SOURCE_ID,
                lastPulledAt: touchedAt,
            }),
        );
        const service = makeService(dal);

        const result = await service.pullFromSource(CLONER, CLONE_ID);

        expect(dal.touchLastPulled).toHaveBeenCalledExactlyOnceWith(CLONE_ID);
        expect(result.collection.lastPulledAt).toBe(touchedAt.toISOString());
    });

    it('W5 Task 3: STILL stamps lastPulledAt when the source has nothing new (the user pulled = they synced)', async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, ['rec-a', 'rec-b'], ['rec-a', 'rec-b']);
        const touchedAt = new Date('2026-07-24T12:05:00.000Z');
        dal.touchLastPulled.mockResolvedValue(
            makeCollectionRow({
                id: CLONE_ID,
                ownerId: CLONER,
                sourceCollectionId: SOURCE_ID,
                lastPulledAt: touchedAt,
            }),
        );
        const service = makeService(dal);

        const result = await service.pullFromSource(CLONER, CLONE_ID);

        expect(dal.addRecipe).not.toHaveBeenCalled();
        expect(dal.touchLastPulled).toHaveBeenCalledExactlyOnceWith(CLONE_ID);
        expect(result.collection.lastPulledAt).toBe(touchedAt.toISOString());
        expect(typeof result.collection.lastPulledAt).toBe('string');
        expect(Number.isNaN(Date.parse(result.collection.lastPulledAt as string))).toBe(false);
    });

    it('rejects a pull on a collection that was never cloned (no source to pull from)', async () => {
        const dal = makeDal();
        const notAClone = makeCollectionRow({ id: CLONE_ID, ownerId: CLONER, sourceCollectionId: null });
        dal.findById.mockResolvedValue(notAClone);
        const service = makeService(dal);

        const error = await service.pullFromSource(CLONER, CLONE_ID).then(
            () => undefined,
            (e: unknown) => e,
        );

        // A distinguishable domain error, not a silent no-op: the client asked for something the
        // collection cannot do, and 400 says so.
        expect(isRecipeDomainError(error)).toBe(true);
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });

    it('refuses a pull by anyone other than the clone owner', async () => {
        const dal = makeDal();
        wireFindById(dal);
        const service = makeService(dal);

        await expect(service.pullFromSource('someone-else', CLONE_ID)).rejects.toBeDefined();
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });

    it('404s when the clone itself does not exist', async () => {
        const dal = makeDal();
        dal.findById.mockResolvedValue(undefined);
        const service = makeService(dal);

        await expect(service.pullFromSource(CLONER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports the source as gone when its provenance pointer was orphaned (ON DELETE SET NULL)', async () => {
        const dal = makeDal();
        // The source row is deleted; `source_collection_id` is ON DELETE SET NULL, but a clone read
        // mid-delete can still carry a pointer to a row that no longer exists.
        dal.findById.mockImplementation(async (id: string) => (id === CLONE_ID ? clone() : undefined));
        const service = makeService(dal);

        const error = await service.pullFromSource(CLONER, CLONE_ID).then(
            () => undefined,
            (e: unknown) => e,
        );

        expect(error).toBeDefined();
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });
});

describe('CollectionsService.previewPull (W8-a.8 — read-only preview)', () => {
    it('returns the added/removed/unchanged diff WITHOUT mutating', async () => {
        const dal = makeDal();
        wireFindById(dal);
        // clone: rec-a rec-c ; source: rec-a rec-b → add rec-b; rec-a unchanged; rec-c is clone-only.
        wireListRecipes(dal, ['rec-a', 'rec-c'], ['rec-a', 'rec-b']);
        const service = makeService(dal);

        const diff = await service.previewPull(CLONER, CLONE_ID);

        expect(diff).toEqual({ added: ['rec-b'], removed: ['rec-c'], unchanged: ['rec-a'] });
        // A preview NEVER writes.
        expect(dal.addRecipe).not.toHaveBeenCalled();
        expect(dal.removeRecipe).not.toHaveBeenCalled();
        // It reads through the read-only-transaction membership read, viewer-scoped to the cloner.
        expect(dal.previewMembershipIds).toHaveBeenCalledWith(CLONE_ID, SOURCE_ID, CLONER);
    });
});

describe('CollectionsService.pullFromSource — drift guard (W8-a.8 / decision 7)', () => {
    it('applies when the echoed previewed diff still matches the live diff', async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, ['rec-a'], ['rec-a', 'rec-b']);
        dal.addRecipe.mockResolvedValue(makeMembershipRow({ recipeId: 'rec-b', addedVia: 'pull' }));
        const service = makeService(dal);

        const previewed = { added: ['rec-b'], removed: [], unchanged: ['rec-a'] };
        const result = await service.pullFromSource(CLONER, CLONE_ID, previewed);

        expect(dal.addRecipe).toHaveBeenCalledExactlyOnceWith(CLONE_ID, 'rec-b', 'pull');
        expect(result.addedRecipeIds).toEqual(['rec-b']);
    });

    it('409s PULL_DRIFT (never writing) when the caller removed a recipe from their OWN clone since preview', async () => {
        const dal = makeDal();
        wireFindById(dal);
        // Live state: the cloner has since DELETED rec-a from their clone, so it is now empty; source still has it.
        // A source-only marker would still "match" and silently re-add rec-a — the exact bug decision 7 closes.
        wireListRecipes(dal, [], ['rec-a']);
        const service = makeService(dal);

        // What the user previewed earlier: rec-a was unchanged (present in both), nothing to add.
        const stalePreview = { added: [], removed: [], unchanged: ['rec-a'] };
        const error = await service.pullFromSource(CLONER, CLONE_ID, stalePreview).then(
            () => undefined,
            (e: unknown) => e,
        );

        expect(isRecipeDomainError(error)).toBe(true);
        expect(isRecipeDomainError(error) && error.code).toBe('PULL_DRIFT');
        // The fresh diff (rec-a now in `added`) rides the error so the client re-previews.
        expect(isRecipeDomainError(error) && (error.details as { diff: { added: string[] } }).diff.added).toEqual([
            'rec-a',
        ]);
        // And it did NOT silently re-add the recipe the user just deleted.
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });

    it('409s PULL_DRIFT when the SOURCE drifted (gained a recipe) since the preview', async () => {
        const dal = makeDal();
        wireFindById(dal);
        wireListRecipes(dal, [], ['rec-a', 'rec-b']); // source now has an extra rec-b vs the preview
        const service = makeService(dal);

        const stalePreview = { added: ['rec-a'], removed: [], unchanged: [] };
        await expect(service.pullFromSource(CLONER, CLONE_ID, stalePreview)).rejects.toBeDefined();
        expect(dal.addRecipe).not.toHaveBeenCalled();
    });
});
