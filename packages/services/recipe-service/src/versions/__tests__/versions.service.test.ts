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
import { PutObjectCommand } from '@aws-sdk/client-s3';

import { VersionsService, versionArchiveKey } from '../versions.service.js';
import type { VersionsDal } from '../dal/versions.dal.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import { makeVersionRow } from '../../__fixtures__/index.js';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';
import type { RecipeVersionRow } from '../../database/schema/index.js';

const BUCKET = 'commise-versions';

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

/** A `{ send }` S3 stub — the surface {@link VersionsService} depends on. */
interface FakeS3 {
    send: ReturnType<typeof vi.fn>;
}

function fakeS3(): FakeS3 {
    return { send: vi.fn().mockResolvedValue({}) };
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

function makeService(dal: VersionsDal, s3: FakeS3): VersionsService {
    return new VersionsService(dal, NOOP_RECIPES, s3, BUCKET);
}

describe('VersionsService.createSnapshot', () => {
    let s3: FakeS3;

    beforeEach(() => {
        s3 = fakeS3();
    });

    it('writes the snapshot via the DAL and maps the row to the RecipeVersion wire contract', async () => {
        const row = makeVersionRow({ id: 'v-1', recipeId: 'r-1', versionNumber: 4, baseVersion: 3 });
        const dal = fakeDal({ createSnapshot: vi.fn().mockResolvedValue(row) });
        const service = makeService(dal, s3);

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

    it('does not touch S3 when the recipe is at or under the retention limit', async () => {
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow()),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue([]),
        });

        await makeService(dal, s3).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 1,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        expect(dal.findVersionsBeyondRetention).toHaveBeenCalledWith('r-1');
        expect(s3.send).not.toHaveBeenCalled();
        expect(dal.deleteById).not.toHaveBeenCalled();
    });

    it('archives every pruned version to the versions bucket, then deletes it from the DB', async () => {
        const overflow: RecipeVersionRow[] = [
            makeVersionRow({ id: 'old-2', recipeId: 'r-1', versionNumber: 2 }),
            makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 }),
        ];
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue(overflow),
            deleteById: vi.fn().mockResolvedValue(undefined),
        });
        const service = makeService(dal, s3);

        await service.createSnapshot({
            recipeId: 'r-1',
            versionNumber: 12,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        // One archive PUT per pruned version, targeting S3_BUCKET_VERSIONS at the deterministic key.
        expect(s3.send).toHaveBeenCalledTimes(2);
        const commands = s3.send.mock.calls.map((call) => call[0] as PutObjectCommand);
        expect(commands.every((command) => command instanceof PutObjectCommand)).toBe(true);
        expect(commands[0]?.input.Bucket).toBe(BUCKET);
        expect(commands[0]?.input.Key).toBe(versionArchiveKey(overflow[0]!));
        expect(commands[1]?.input.Key).toBe(versionArchiveKey(overflow[1]!));

        // And each pruned version is removed from Postgres.
        expect(dal.deleteById).toHaveBeenCalledWith('old-2');
        expect(dal.deleteById).toHaveBeenCalledWith('old-1');
    });

    it('archives to S3 BEFORE deleting from the DB (a snapshot is never lost)', async () => {
        const order: string[] = [];
        const overflow = [makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })];
        const s3Ordered: FakeS3 = {
            send: vi.fn().mockImplementation(async () => {
                order.push('archive');
                return {};
            }),
        };
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 11 })),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue(overflow),
            deleteById: vi.fn().mockImplementation(async () => {
                order.push('delete');
            }),
        });

        await makeService(dal, s3Ordered).createSnapshot({
            recipeId: 'r-1',
            versionNumber: 11,
            snapshot: SNAPSHOT,
            createdBy: 'owner-1',
        });

        expect(order).toEqual(['archive', 'delete']);
    });
});

describe('VersionsService.restore', () => {
    const OWNER = '01J000000000000000000FREE0';
    const RECIPE_ID = 'r-1';

    const TARGET_SNAPSHOT: RecipeSnapshot = {
        version: 3,
        title: 'Old Title',
        description: 'old',
        steps: [{ instruction: 'Old step' }],
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
    const RESTORED_RECIPE = { id: RECIPE_ID, ownerId: OWNER, title: 'Old Title', version: 6 };

    function fakeRecipes(overrides: Record<string, unknown> = {}): RecipesService {
        return {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, version: 5 }),
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
        const service = new VersionsService(dal, recipes, fakeS3(), BUCKET);

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
        const recipes = fakeRecipes({ getById: vi.fn().mockResolvedValue({ ownerId: 'someone-else', version: 5 }) });
        const service = new VersionsService(dal, recipes, fakeS3(), BUCKET);

        await expect(service.restore(OWNER, RECIPE_ID, 3)).rejects.toBeDefined();
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('throws RECIPE_NOT_FOUND (404) when the recipe has no version with that number', async () => {
        const dal = fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) });
        const service = new VersionsService(dal, fakeRecipes(), fakeS3(), BUCKET);

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
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, version: 2 }),
        } as unknown as RecipesService;
        const service = new VersionsService(fakeDal({ findByRecipeAndVersion }), recipes, fakeS3(), BUCKET);

        const result = await service.get(OWNER, RECIPE_ID, 2);

        expect(findByRecipeAndVersion).toHaveBeenCalledWith(RECIPE_ID, 2);
        expect(result).toMatchObject({ id: 'v-2', versionNumber: 2 });
    });

    it('throws RECIPE_NOT_FOUND (404) when the recipe has no version with that number', async () => {
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, version: 2 }),
        } as unknown as RecipesService;
        const service = new VersionsService(
            fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) }),
            recipes,
            fakeS3(),
            BUCKET,
        );

        await expect(service.get(OWNER, RECIPE_ID, 99)).rejects.toBeDefined();
    });
});

describe('VersionsService retention S3 failure (best-effort)', () => {
    it('does NOT delete an un-archived version and does not throw when the archive PUT fails', async () => {
        const overflow = [makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })];
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 11 })),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue(overflow),
        });
        const s3 = { send: vi.fn().mockRejectedValue(new Error('S3 down')) };
        const service = makeService(dal, s3);

        // The recipe save (which triggers retention) must succeed even though archiving failed...
        await expect(
            service.createSnapshot({ recipeId: 'r-1', versionNumber: 11, snapshot: SNAPSHOT, createdBy: 'owner-1' }),
        ).resolves.toBeDefined();
        // ...and the un-archived row must NOT be deleted (archive-before-delete invariant preserved).
        expect(dal.deleteById).not.toHaveBeenCalled();
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
