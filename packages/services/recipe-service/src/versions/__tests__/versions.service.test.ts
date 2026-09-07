/**
 * T031-test — unit tests for {@link VersionsService} over a fake {@link VersionsDal} and a fake
 * {@link PendingArchivesDal} (the archive outbox).
 *
 * Pins the service's responsibilities AS SHIPPED post-T130:
 *   1. **Snapshot write** — persistence row → the `RecipeVersion` wire contract (ISO `createdAt`).
 *   2. **Retention enqueue** — after a write, each version beyond the newest 10 is recorded in the
 *      `recipe_version_pending_archives` outbox (one idempotent row per version, keyed for the worker).
 *   3. **No prune, no S3** — the version row is NEVER deleted here (it is the payload the async retry
 *      replays), and the save NEVER writes S3 or fails on an outbox error — the version-archive worker
 *      archives-then-prunes out of band.
 *
 * No database, no S3, no SQS are involved: the DAL is a `vi.fn()` fake and the outbox is a fake whose
 * `enqueue` calls are asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { VersionsService, versionArchiveKey } from '../versions.service.js';
import type { VersionsDal } from '../dal/versions.dal.js';
import type { PendingArchivesDal, EnqueueArchiveInput } from '../dal/pendingArchives.dal.js';
import type { VersionArchiveReader } from '../versionArchive.storage.js';
import type { RecipesService } from '../../recipes/recipes.service.js';
import type { Principal } from '../../auth/principal.js';
import { makeVersionRow } from '../../__fixtures__/index.js';
import { RecipeErrorCode, type RecipeSnapshot } from '@kitchensink/recipe-core';
import type { RecipeVersionRow } from '../../database/schema/index.js';
import { FAKE_TX } from '../../recipes/__fixtures__/recipesDal.fixture.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

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
    enqueueMany: Mock<(inputs: readonly EnqueueArchiveInput[], tx: RecipeTx) => Promise<unknown>>;
}

function fakePendingArchives(): FakePendingArchives {
    return { enqueueMany: vi.fn().mockResolvedValue([{ id: 'pa-1' }]) };
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

/** A version-archive reader that finds nothing (the default — DB-hit paths never consult S3). Override per test. */
function noArchive(read: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)): VersionArchiveReader {
    return { read } as unknown as VersionArchiveReader;
}

function makeService(dal: VersionsDal, pending: FakePendingArchives = fakePendingArchives()): VersionsService {
    return new VersionsService(dal, NOOP_RECIPES, pending as unknown as PendingArchivesDal, noArchive());
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

        const result = await service.createSnapshot(
            {
                recipeId: 'r-1',
                versionNumber: 4,
                snapshot: SNAPSHOT,
                createdBy: 'owner-1',
                baseVersion: 3,
            },
            FAKE_TX,
        );

        expect(dal.createSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ recipeId: 'r-1', versionNumber: 4, createdBy: 'owner-1', baseVersion: 3 }),
            FAKE_TX,
        );
        expect(result).toMatchObject({ id: 'v-1', recipeId: 'r-1', versionNumber: 4, baseVersion: 3 });
        expect(typeof result.createdAt).toBe('string');
    });

    it('enqueues nothing when the recipe is at or under the retention limit', async () => {
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow()),
            findVersionsBeyondRetention: vi.fn().mockResolvedValue([]),
        });

        await makeService(dal, pending).createSnapshot(
            {
                recipeId: 'r-1',
                versionNumber: 1,
                snapshot: SNAPSHOT,
                createdBy: 'owner-1',
            },
            FAKE_TX,
        );

        expect(dal.findVersionsBeyondRetention).toHaveBeenCalledWith('r-1', FAKE_TX);
        // ⚠️ CALLED, with an EMPTY list — not "not called". The batched write owns the empty case (it
        // issues no statement), so the service asks unconditionally and the DAL decides. Asserting
        // "not called" here would pin a decision that no longer lives in this class.
        expect(pending.enqueueMany).toHaveBeenCalledWith([], FAKE_TX);
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

        await makeService(dal, pending).createSnapshot(
            {
                recipeId: 'r-1',
                versionNumber: 12,
                snapshot: SNAPSHOT,
                createdBy: 'owner-1',
            },
            FAKE_TX,
        );

        // The row carries versionNumber because that is what the archive object is KEYED by (ARCH-BE-3)
        // — the worker builds `recipeVersionArchiveKey` from it without re-reading the version row.
        // ONE call carrying every over-retention version, in the same transaction as the version row —
        // the Outbox contract: the record of the debt commits with the row that incurs it.
        expect(pending.enqueueMany).toHaveBeenCalledTimes(1);
        expect(pending.enqueueMany).toHaveBeenCalledWith(
            [
                { recipeVersionId: 'old-2', recipeId: 'r-1', versionNumber: 2 },
                { recipeVersionId: 'old-1', recipeId: 'r-1', versionNumber: 1 },
            ],
            FAKE_TX,
        );
    });

    it('NEVER prunes the version row itself — the payload must outlive the save (FR-007b-i)', async () => {
        const dal = fakeDal({
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi
                .fn()
                .mockResolvedValue([makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })]),
            deleteById: vi.fn(),
        });

        await makeService(dal, pending).createSnapshot(
            {
                recipeId: 'r-1',
                versionNumber: 12,
                snapshot: SNAPSHOT,
                createdBy: 'owner-1',
            },
            FAKE_TX,
        );

        // THE load-bearing assertion of the cutover. The outbox row is ON DELETE CASCADE on the version
        // row, so pruning here would delete the record of the debt AND the snapshot the retry replays —
        // losing the archive with no trace. Only the worker prunes, and only after S3 confirms.
        expect(dal.deleteById).not.toHaveBeenCalled();
    });

    it('⛔ FAILS the save when the outbox write fails — the debt commits with the row that incurs it', async () => {
        // ⚠️ REWRITTEN (owner ruling 2026-09-06). This asserted the opposite: that an outbox failure was
        // swallowed so the save still succeeded, on FR-007b-i's "a save MUST succeed independently of the
        // S3 version-archive write". That requirement binds the S3 WRITE, and still does — the outbox row
        // is Postgres, and it is now written in the save's own transaction.
        //
        // The swallow's stated safety net was that "the next save re-enqueues, idempotently". True only
        // IF THERE IS A NEXT SAVE: a recipe whose owner never edits again never re-derived its overflow,
        // so that version was never archived, with no alert and no DLQ. `archiveSweeper` selects FROM the
        // outbox, so it can only re-drive a row that already exists.
        //
        // ⛔ And the catch could not have survived anyway: Postgres aborts a transaction on any statement
        // error, so swallowing inside one would silently discard the whole save.
        const dal = fakeDal({
            createSnapshot: vi
                .fn()
                .mockResolvedValue(makeVersionRow({ id: 'v-new', recipeId: 'r-1', versionNumber: 12 })),
            findVersionsBeyondRetention: vi
                .fn()
                .mockResolvedValue([makeVersionRow({ id: 'old-1', recipeId: 'r-1', versionNumber: 1 })]),
        });
        const failing: FakePendingArchives = { enqueueMany: vi.fn().mockRejectedValue(new Error('db down')) };

        await expect(
            makeService(dal, failing).createSnapshot(
                { recipeId: 'r-1', versionNumber: 12, snapshot: SNAPSHOT, createdBy: 'owner-1' },
                FAKE_TX,
            ),
        ).rejects.toThrow('db down');
    });
});

describe('VersionsService.restore', () => {
    const OWNER = '01J000000000000000000FREE0';
    const PRINCIPAL: Principal = { userId: OWNER, sub: 'clerk_sub', scopes: [], permissions: [] };
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
                quantity: { kind: 'exact', value: 2 },
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
        const service = new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        const result = await service.restore(PRINCIPAL, RECIPE_ID, 3);

        // The version is addressed by its integer number, scoped to the recipe (not a row UUID).
        expect(findByRecipeAndVersion).toHaveBeenCalledWith(RECIPE_ID, 3);
        // The restore reverts ingredients too — not just title/steps/times (the previously-dropped case).
        expect(recipes.update).toHaveBeenCalledWith(
            PRINCIPAL,
            RECIPE_ID,
            expect.objectContaining({
                title: 'Old Title',
                ingredients: [
                    expect.objectContaining({
                        ingredientId: '00000000-0000-4000-8000-0000000000aa',
                        name: 'Flour',
                        quantity: { kind: 'exact', value: 2 },
                        unit: 'cup',
                        notes: 'sifted',
                    }),
                ],
            }),
            // ⚠️ The restore now STATES what its version records instead of suppressing it. There is one
            // writer, so "two versions at the same number" is unreachable rather than avoided by a flag.
            { snapshot: { changeSummary: 'Restored from version 3', baseVersion: 3 } },
        );
        // ⛔ ZERO, not one. The restore no longer writes its own version — `RecipesService.update` records
        // it inside the same transaction as the content write, from the directive above. Asserting the
        // absence is what stops the old second writer being reintroduced.
        expect(dal.createSnapshot).not.toHaveBeenCalled();
        // The response is the { recipe, restoredFromVersion, currentVersion } envelope, not the version row.
        expect(result).toEqual({ recipe: RESTORED_RECIPE, restoredFromVersion: 3, currentVersion: 6 });
    });

    it("records the restorer's editor handle (deriveDisplayName) on the restore snapshot (W6 attribution)", async () => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT });
        const dal = fakeDal({
            findByRecipeAndVersion: vi.fn().mockResolvedValue(target),
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: RECIPE_ID, versionNumber: 6 })),
        });
        const recipes = fakeRecipes();
        const service = new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        // ⚠️ REWRITTEN. The restorer is still the editor of the new version, but the handle is derived by
        // `RecipesService.update` from the same principal — one rule for all four write paths — so this
        // asserts the principal is FORWARDED rather than that this class derived a handle itself.
        const restorer = { ...PRINCIPAL, firstName: 'Amy', lastName: 'Pond' };

        await service.restore(restorer, RECIPE_ID, 3);

        expect(recipes.update).toHaveBeenCalledWith(restorer, RECIPE_ID, expect.anything(), expect.anything());
        expect(dal.createSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a non-owner with NOT_OWNER and never mutates the recipe', async () => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT });
        const dal = fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(target) });
        const recipes = fakeRecipes({
            getById: vi.fn().mockResolvedValue({ ownerId: 'someone-else', currentVersion: 5 }),
        });
        const service = new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        await expect(service.restore(PRINCIPAL, RECIPE_ID, 3)).rejects.toMatchObject({
            code: RecipeErrorCode.NOT_OWNER,
        });
        expect(recipes.update).not.toHaveBeenCalled();
    });

    it('throws RECIPE_NOT_FOUND (404) when the recipe has no version with that number', async () => {
        const dal = fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) });
        const service = new VersionsService(
            dal,
            fakeRecipes(),
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        await expect(service.restore(PRINCIPAL, RECIPE_ID, 99)).rejects.toMatchObject({
            code: RecipeErrorCode.RECIPE_NOT_FOUND,
        });
        expect(dal.createSnapshot).not.toHaveBeenCalled();
    });

    it('records the restore snapshot with its provenance (baseVersion + changeSummary) on the happy path', async () => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT });
        const dal = fakeDal({
            findByRecipeAndVersion: vi.fn().mockResolvedValue(target),
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: RECIPE_ID, versionNumber: 6 })),
        });
        const recipes = fakeRecipes();
        const service = new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        await service.restore(PRINCIPAL, RECIPE_ID, 3);

        // ⚠️ REWRITTEN. The restore's provenance now travels as a DIRECTIVE into the update that records
        // it, rather than as a second snapshot write this class performs afterwards. The provenance
        // itself is unchanged and still asserted — it is where it is written that moved.
        expect(recipes.update).toHaveBeenCalledWith(PRINCIPAL, RECIPE_ID, expect.anything(), {
            snapshot: { changeSummary: 'Restored from version 3', baseVersion: 3 },
        });
        expect(dal.createSnapshot).not.toHaveBeenCalled();
    });

    it('⛔ FAILS the restore when its version row cannot be written', async () => {
        // ⚠️ REWRITTEN (owner ruling 2026-09-06). This asserted that a restore returned 200 even when its
        // snapshot write threw, because `recipes.update` had already committed the content. That is
        // exactly the defect: a restore reported as done, with no record that it happened.
        //
        // The restore no longer writes its own version at all — it states a `SnapshotDirective` and
        // `RecipesService.update` records it inside the same transaction as the content write. So the
        // failure now propagates from `update`, and the content does not commit either.
        const recipes = fakeRecipes();

        recipes.update = vi.fn().mockRejectedValue(new Error('version row refused'));

        const dal = fakeDal({
            findByRecipeAndVersion: vi
                .fn()
                .mockResolvedValue(
                    makeVersionRow({ recipeId: RECIPE_ID, versionNumber: 3, snapshot: TARGET_SNAPSHOT }),
                ),
        });

        const service = new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        );

        await expect(service.restore(PRINCIPAL, RECIPE_ID, 3)).rejects.toThrow('version row refused');
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
            noArchive(),
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
            noArchive(),
        );

        await expect(service.get(OWNER, RECIPE_ID, 99)).rejects.toMatchObject({
            code: RecipeErrorCode.RECIPE_NOT_FOUND,
        });
    });

    it('falls back to the S3 archive when the version is evicted past the DB window (W8-a.7)', async () => {
        // The DB has pruned v2, but the archive reader finds it — get returns it transparently (no 404).
        const archived = makeVersionRow({ id: 'v-arch', recipeId: RECIPE_ID, versionNumber: 2 });
        const archivedVersion = { ...archived, createdAt: archived.createdAt.toISOString() };
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 12 }),
        } as unknown as RecipesService;
        const read = vi.fn().mockResolvedValue(archivedVersion);
        const service = new VersionsService(
            fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) }),
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(read),
        );

        const result = await service.get(OWNER, RECIPE_ID, 2);

        expect(result.versionNumber).toBe(2);
        // Keyed under the recipe OWNER's archive prefix (where the worker wrote it).
        expect(read).toHaveBeenCalledWith(expect.stringContaining(`${OWNER}/${RECIPE_ID}/versions/2.json`));
    });

    it('404s only when BOTH the DB and the S3 archive miss (W8-a.7)', async () => {
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 12 }),
        } as unknown as RecipesService;
        const service = new VersionsService(
            fakeDal({ findByRecipeAndVersion: vi.fn().mockResolvedValue(undefined) }),
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(vi.fn().mockResolvedValue(undefined)),
        );

        await expect(service.get(OWNER, RECIPE_ID, 99)).rejects.toMatchObject({
            code: RecipeErrorCode.RECIPE_NOT_FOUND,
        });
    });

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

describe('VersionsService.restore — the preparation and the section come back (U26/U27)', () => {
    const RECIPE_ID = '00000000-0000-4000-8000-00000000a001';
    const OWNER = '01J000000000000000000OWNER';
    const PRINCIPAL = { userId: OWNER, sub: 'user_clerk', scopes: [], permissions: [] } as unknown as Principal;

    /**
     * ⛔ A RESTORE THAT CANNOT CARRY A FIELD SILENTLY STRIPS IT, and that is worse than never storing it: the
     * cook is told the version was restored, and the preparation is gone with nothing naming the loss.
     *
     * ⚠️ This is also the load-bearing consequence of U26/U27's placement ruling. The restore rebuilds an
     * **UPDATE body** from the snapshot, so a field placed on the CREATE-only element schema (as `sourceLine`
     * and `statedMeasure` are, for ADR-0023 reasons that do not apply here) could not be restored AT ALL.
     * Both fields are on the BASE precisely so this rebuild can carry them.
     */
    const snapshotWithBoth = (): RecipeSnapshot => ({
        version: 3,
        title: 'Old Title',
        description: 'old',
        steps: [{ id: 'rs-1', recipeId: RECIPE_ID, stepNumber: 1, instruction: 'Old step' }],
        ingredients: [
            {
                id: 'ri-1',
                recipeId: RECIPE_ID,
                ingredientId: '00000000-0000-4000-8000-0000000000aa',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                displayText: 'sifted',
                preparation: 'finely chopped',
                groupLabel: 'For the marinade',
                sortOrder: 0,
                ingredientName: 'Flour',
                isUserEntered: false,
            },
        ],
        servings: 4,
        prepTimeMinutes: 5,
        cookTimeMinutes: 10,
    });

    /** Run a restore over the given snapshot and return the UPDATE body it rebuilt. */
    const restoredUpdateBody = async (snapshot: RecipeSnapshot): Promise<Record<string, unknown>> => {
        const target = makeVersionRow({ id: 'v-3', recipeId: RECIPE_ID, versionNumber: 3, snapshot });
        const dal = fakeDal({
            findByRecipeAndVersion: vi.fn().mockResolvedValue(target),
            createSnapshot: vi.fn().mockResolvedValue(makeVersionRow({ recipeId: RECIPE_ID, versionNumber: 6 })),
        });
        const recipes = {
            getById: vi.fn().mockResolvedValue({ ownerId: OWNER, currentVersion: 5 }),
            update: vi.fn().mockResolvedValue({ id: RECIPE_ID, ownerId: OWNER, currentVersion: 6 }),
        } as unknown as RecipesService;

        await new VersionsService(
            dal,
            recipes,
            fakePendingArchives() as unknown as PendingArchivesDal,
            noArchive(),
        ).restore(PRINCIPAL, RECIPE_ID, 3);

        // `update(principal, recipeId, body, options)` — the rebuilt body is the THIRD argument.
        return (recipes.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    };

    it('⛔ puts BOTH fields back on the restored line', async () => {
        const body = await restoredUpdateBody(snapshotWithBoth());
        const line = (body['ingredients'] as Record<string, unknown>[])[0];

        expect(line).toMatchObject({
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
            notes: 'sifted',
            name: 'Flour',
        });
    });

    it('OMITS both when the snapshot carried neither, rather than restoring `""`', async () => {
        const snapshot = snapshotWithBoth();
        const bare: RecipeSnapshot = {
            ...snapshot,
            ingredients: snapshot.ingredients.map(({ preparation: _p, groupLabel: _g, ...rest }) => rest),
        };

        const body = await restoredUpdateBody(bare);
        const line = (body['ingredients'] as Record<string, unknown>[])[0];

        expect(line).not.toHaveProperty('preparation');
        expect(line).not.toHaveProperty('groupLabel');
    });
});
