/**
 * T031-test — unit tests for {@link VersionsService} over a fake {@link VersionsDal} and a MOCKED S3
 * client.
 *
 * Pins the three responsibilities the DAL delegates upward:
 *   1. **Snapshot write** — persistence row → the `RecipeVersion` wire contract (ISO `createdAt`).
 *   2. **DB retention pruning** — after a write, versions beyond the newest 10 are deleted from Postgres.
 *   3. **S3 archive** — every pruned version is written to the `S3_BUCKET_VERSIONS` bucket (a
 *      `PutObjectCommand`) BEFORE it is deleted, so a snapshot is never lost.
 *
 * No database and no real S3 are involved: the DAL is a `vi.fn()` fake and the S3 client is a
 * `{ send }` stub whose recorded `PutObjectCommand.input` is asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { VersionsService, versionArchiveKey } from '../versions.service.js';
import type { VersionsDal } from '../dal/versions.dal.js';
import type { PendingArchivesDal, EnqueueArchiveInput } from '../dal/pending-archives.dal.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import { makeVersionRow } from '../../__fixtures__/index.js';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import type { RecipeVersionRow } from '../../database/schema/index.js';

const SNAPSHOT: RecipeSnapshot = {
    version: 1,
    title: 'Soup',
    description: '',
    steps: [],
    ingredients: [],
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
};

/**
 * A stub of the FR-007b-i archive outbox — the surface {@link VersionsService} now depends on in place
 * of an S3 client (T130). Typed to the real {@link PendingArchivesDal} method signature so the double
 * drifts from the contract at compile time rather than silently.
 */
interface FakePendingArchives {
    enqueue: Mock<(input: EnqueueArchiveInput) => Promise<unknown>>;
}

function fakePendingArchives(): FakePendingArchives {
    return { enqueue: vi.fn().mockResolvedValue({ id: 'pa-1' }) };
}

function fakeDal(overrides: Partial<VersionsDal> = {}): VersionsDal {
    return {
        createSnapshot: vi.fn(),
        listByRecipe: vi.fn(),
        findByRecipeAndVersion: vi.fn(),
        findVersionsBeyondRetention: vi.fn().mockResolvedValue([]),
        deleteById: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as VersionsDal;
}

/** The recipes service is unused by the snapshot/retention paths under test. */
const NOOP_RECIPES = {} as unknown as RecipesService;

function makeService(dal: VersionsDal, pending: FakePendingArchives = fakePendingArchives()): VersionsService {
    return new VersionsService(dal, NOOP_RECIPES, pending as unknown as PendingArchivesDal);
}

describe('VersionsService.createSnapshot', () => {
    let pending: FakePendingArchives;

    beforeEach(() => {
        pending = fakePendingArchives();
    });

    it('writes the snapshot via the DAL and maps the row to the RecipeVersion wire contract', async () => {
        const row = makeVersionRow({ id: 'v-1', recipeId: 'r-1', versionNumber: 4, baseVersion: 3 });
        const dal = fakeDal({ createSnapshot: vi.fn().mockResolvedValue(row) });
        const service = makeService(dal, pending);

        const result = await service.createSnapshot({
            recipeId: 'r-1',
            versionNumber: 4,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
            baseVersion: 3,
        });

        expect(dal.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: 'r-1', versionNumber: 4, createdBy: 'owner-1', baseVersion: 3 }),
        );
        expect(result).toMatchObject({ id: 'v-1', recipeId: 'r-1', versionNumber: 4, baseVersion: 3 });
        expect(typeof result.createdAt).toBe('string');
    });

    it('enqueues nothing when the recipe is at or under the retention limit', async () => {
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow()),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue([]),
        });

        await makeService(dal, pending).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 1,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        expect(dal.findVersionsBeyondRetention).toHaveBeenCalledWith('r-1');
        expect(pending.enqueue).not.toHaveBeenCalled();
        expect(dal.deleteById).not.toHaveBeenCalled();
    });

    it('enqueues one outbox row per over-retention version, keyed for the archive worker', async () => {
        const overflow: RecipeVersionRow[] = [
            makeVersionRow({ id: 'old-2', recipeId: 'r-1', versionNumber: 2 }),
            makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 }),
        ];
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue(overflow),
        });

        await makeService(dal, pending).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 12,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        // The row carries versionNumber because that is what the archive object is KEYED by (ARCH-BE-3)
        // — the worker builds `recipeVersionArchiveKey` from it without re-reading the version row.
        expect(pending.enqueue).toHaveBeenCalledTimes(2);
        expect(pending.enqueue).toHaveBeenCalledWith({ recipeVersionId: 'old-2', recipeId: 'r-1', versionNumber: 2 });
        expect(pending.enqueue).toHaveBeenCalledWith({ recipeVersionId: 'old-1', recipeId: 'r-1', versionNumber: 1 });
    });

    it('NEVER prunes the version row itself — the payload must outlive the save (FR-007b-i)', async () => {
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi
                .fn()
                .mockResolvedValue([makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })]),
            deleteById: vi.fn(),
        });

        await makeService(dal, pending).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 12,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        // THE load-bearing assertion of the cutover. The outbox row is ON DELETE CASCADE on the version
        // row, so pruning here would delete the record of the debt AND the snapshot the retry replays —
        // losing the archive with no trace. Only the worker prunes, and only after S3 confirms.
        expect(dal.deleteById).not.toHaveBeenCalled();
    });

    it('still returns a successful save when the outbox write fails (FR-007b-i)', async () => {
        const dal = fakeDal({
            createSnapshot: vi
                .fn()
                .mockResolvedValue(makeVersionRow({ id: 'v-new', recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi
                .fn()
                .mockResolvedValue([makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })]),
        });
        const failing: FakePendingArchives = { enqueue: vi.fn().mockRejectedValue(new Error('db down')) };

        // "A user-facing recipe save MUST succeed independently of the S3 version-archive write." The
        // save has already committed; an outbox failure is recoverable (the next save re-enqueues,
        // idempotently), so it must never surface to the user.
        const result = await makeService(dal, failing).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 12,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        expect(result.id).toBe('v-new');
    });
});

describe('VersionsService.restore', () => {
    const OWNER = '01J000000000000000000FREE0';
    const RECIPE_ID = 'r-1';

    const TARGET_SNAPSHOT: RecipeSnapshot = {
        version: 3,
        title: 'Old Title',
        description: 'old',
        // A snapshot's steps are full `RecipeStep`s — `recipeSnapshotSchema` rejects a bare
        // `{ instruction }`, so the archived shape must carry the identity fields too.
        steps: [{ id: 'rs-1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Old step' }],
        ingredients: [
            {
                id: 'ri-1',
                recipeId: RECIPE_ID,
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                quantity: 2,
                unit: 'cup',
                displayText: 'sifted',
                sortOrder: 0,
                ingredientName: 'Flour',
                isUserEntered: false,
            },
        ],
        servings: 4,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
    };

    /** The restored recipe the fake `update` returns — stands in for the RecipeResponse in the envelope. */
    const RESTORED_RECIPE = { id: RECIPE_ID, ownerId: OWNER, title: 'Old Title', currentVersion: 6 };

    function fakeRecipes(overrides: Record<string, unknown> = {}): RecipesService {
        return {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 5 }),
            update: vi.fn().mockResolvedValue(RESTORED_RECIPE),
            ...overrides,
        } as unknown as RecipesService;
    }

    it('restores by versionNumber, applying the snapshot (incl. ingredients) and returning the envelope', async () => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT });
        const findByRecipeAndVersion = vi.fn().mockResolvedValue(target);
        const dal = fakeDal({
            findByRecipeAndVersion,
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: RECIPE_ID, versionNumber: 6 })),
        });
        const recipes = fakeRecipes();
        const service = new VersionsService(dal, recipes, fakePendingArchives() as unknown as PendingArchivesDal);

        const result = await service.restore(OWNER, RECIPE_ID, 3);

        // The version is addressed by its integer number, scoped to the recipe (not a row UUID).
        expect(findByRecipeAndVersion).toHaveBeenCalledWith(RECIPE_ID, 3);
        // The restore reverts ingredients too — not just title/steps/times (the previously-dropped case).
        expect(recipes.update).toHaveBeenCalledWith(
            OWNER,
            RECIPE_ID,
            expect.objectContaining({
                title: 'Old Title',
                ingredients: [
                    expect.objectContaining({
                        ingredientId: '00000000-0000-4000-8000-0000000000aa',
                        name: 'Flour',
                        quantity: 2,
                        unit: 'cup',
                        notes: 'sifted',
                    }),
                ],
            }),
            // The update must OPT OUT of auto-snapshotting so the restore records exactly one version
            // (its own, below) rather than two at the same number.
            { recordSnapshot: false },
        );
        // Exactly one snapshot: the restore's own (the update was told not to record).
        expect(dal.createSnapshot).toHaveBeenCalledOnce();
        // The response is the { recipe, restoredFromVersion, currentVersion } envelope, not the version row.
        expect(result).toEqual({ recipe: RESTORED_RECIPE, restoredFromVersion: 3, currentVersion: 6 });
    });

    it('rejects a non-owner with NOT_OWNER and never mutates the recipe', async () => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT });
        const dal = fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(target) });
        const recipes = fakeRecipes({
            getById: vi.fn().mockResolvedValue({ ownerId: 'someone-else', currentVersion: 5 }),
        });
        const service = new VersionsService(dal, recipes, fakePendingArchives() as unknown as PendingArchivesDal);

        await expect(service.restore(OWNER, RECIPE_ID, 3)).rejects.toBeDefined();
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('throws RECIPE_NOT_FOUND (404) when the recipe has no version with that number', async () => {
        const dal = fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) });
        const service = new VersionsService(dal, fakeRecipes(), fakePendingArchives() as unknown as PendingArchivesDal);

        await expect(service.restore(OWNER, RECIPE_ID, 99)).rejects.toBeDefined();
        expect(dal.createSnapshot).not.toHaveBeenCalled();
    });
});

describe('VersionsService.get', () => {
    const OWNER = '01J000000000000000000FREE0';
    const RECIPE_ID = 'r-1';

    it('fetches a version by its integer versionNumber, scoped to the recipe', async () => {
        const row = makeVersionRow({ id: 'v-2', recipeId: RECIPE_ID, versionNumber: 2 });
        const findByRecipeAndVersion = vi.fn().mockResolvedValue(row);
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 2 }),
        } as unknown as RecipesService;
        const service = new VersionsService(
            fakeDal({ findByRecipeAndVersion }),
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
        );

        const result = await service.get(OWNER, RECIPE_ID, 2);

        expect(findByRecipeAndVersion).toHaveBeenCalledWith(RECIPE_ID, 2);
        expect(result).toMatchObject({ id: 'v-2', versionNumber: 2 });
    });

    it('throws RECIPE_NOT_FOUND (404) when the recipe has no version with that number', async () => {
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 2 }),
        } as unknown as RecipesService;
        const service = new VersionsService(
            fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) }),
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
        );

        await expect(service.get(OWNER, RECIPE_ID, 99)).rejects.toBeDefined();
    });
});

describe('versionArchiveKey', () => {
    it('builds a deterministic per-owner, per-recipe, per-version key', () => {
        const row = makeVersionRow({ createdBy: 'owner-9', recipeId: 'r-1', versionNumber: 7 });
        expect(versionArchiveKey(row)).toBe('recipes/owner-9/r-1/versions/7.json');
    });

    // GDPR (verticals-8): the archive MUST live under the owner prefix `recipes/{ownerId}/` that account
    // erasure sweeps — otherwise version archives survive a user's deletion. Dropping the owner segment
    // (the old key) fails this invariant.
    it('is under the owner prefix that GDPR erasure deletes', () => {
        const row = makeVersionRow({ createdBy: 'owner-9', recipeId: 'r-1', versionNumber: 7 });
        expect(versionArchiveKey(row).startsWith('recipes/owner-9/')).toBe(true);
    });
});
