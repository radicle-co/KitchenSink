/**
 * T031 — recipe-version orchestration: snapshot writes and retention enqueue (NOT S3 archiving — that
 * moved to the async version-archive worker in T130; see `enforceRetention`).
 *
 * Sits between the controller and the {@link VersionsDal}. It owns the rules the DAL delegates upward:
 * - **Snapshot write** — persist an immutable version row and shape it to the `RecipeVersion` wire
 *   contract.
 * - **Retention (FR-007b / FR-007b-i)** — Postgres keeps only the newest 10 versions of a recipe. This
 *   service does NOT archive or prune: over-retention versions are recorded in the
 *   `recipe_version_pending_archives` outbox, and the version-archive worker writes them to S3 and
 *   prunes them once the write confirms (T130 — archive-before-delete, across the async boundary). A
 *   user's save therefore never waits on, or fails because of, S3.
 * - **Read + restore** — list/get a recipe's versions (read-authorized through {@link RecipesService}),
 *   and restore an old snapshot as a new current version (owner-only).
 *
 * Ownership is ALWAYS the app-user ULID, never the Clerk `sub` (D2).
 */
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { recipeVersionArchiveKey } from '@kitchensink/recipe-core';
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsDal, type CreateSnapshotInput } from './dal/versions.dal.js';
import type { RecipeTx } from '../database/unitOfWork.js';
import { PendingArchivesDal } from './dal/pendingArchives.dal.js';
import { VERSION_ARCHIVE_READER, type VersionArchiveReader } from './versionArchive.storage.js';
import { upgradeStoredSnapshot } from './snapshotUpgrade.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner, recipeNotFound } from '../recipes/recipe.error.js';
import type { Principal } from '../auth/principal.js';
import type { RecipeResponse } from '../recipes/dto/recipeResponse.dto.js';
import type { RecipeVersionRow } from '../database/schema/index.js';

/**
 * Result of a version restore: the recipe after the restore, the version restored FROM, and the recipe's
 * new current version number. Mirrors the `RestoreVersionResponse` wire contract (`recipe-core`); the
 * `recipe` is this service's `RecipeResponse` (the recipe-detail serialization the whole recipes vertical
 * emits — its own reconciliation to the `recipe-core` `Recipe` shape is tracked separately).
 */
export interface RestoreVersionResult {
    recipe: RecipeResponse;
    restoredFromVersion: number;
    currentVersion: number;
}

/** DI token for the version DAL — provided by `VersionsModule` via `useFactory` over the Drizzle client. */
export const VERSIONS_DAL = 'VERSIONS_DAL';

/**
 * Deterministic S3 object key for a version archive: one immutable object per recipe/version.
 *
 * A thin row→parts adapter over the shared {@link recipeVersionArchiveKey} — the scheme itself now has
 * exactly one home (`@kitchensink/recipe-core`'s `recipeObjectKeys`), shared with the version-archive
 * and account-erasure workers. That unification is ARCH-BE-3, and it settled the service/worker split
 * onto `versionNumber` (the client-facing address) over the internal `versionId`. The owner-prefix
 * containment that GDPR erasure depends on (verticals-8) is enforced and tested there; this function
 * only maps the persistence row onto it, since recipe-core must not know the DB row shape. Pure.
 */
export function versionArchiveKey(row: RecipeVersionRow): string {
    return recipeVersionArchiveKey({
        ownerId: row.createdBy,
        recipeId: row.recipeId,
        versionNumber: row.versionNumber,
    });
}

/** Map a persisted `recipe_versions` row to the `RecipeVersion` wire contract. Pure. */
function toRecipeVersion(row: RecipeVersionRow): RecipeVersion {
    return {
        id: row.id,
        recipeId: row.recipeId,
        versionNumber: row.versionNumber,
        // ⚠️ NOT a bare cast any more: a snapshot cut before U8 spells its quantities as bare numbers, and
        // a version is immutable so no migration will ever rewrite one. See `snapshotUpgrade.ts`.
        snapshot: upgradeStoredSnapshot(row.snapshot),
        ...(row.baseVersion !== null ? { baseVersion: row.baseVersion } : {}),
        ...(row.s3Key !== null ? { s3Key: row.s3Key } : {}),
        createdBy: row.createdBy,
        ...(row.changeSummary !== null ? { changeSummary: row.changeSummary } : {}),
        // Editor handle (W8-a.2) — the "by @handle" attribution; OMITTED when NULL (falls back to the ULID).
        ...(row.editorHandle !== null ? { editorHandle: row.editorHandle } : {}),
        createdAt: row.createdAt.toISOString(),
    };
}

@Injectable()
export class VersionsService {
    public constructor(
        @Inject(VERSIONS_DAL) private readonly dal: VersionsDal,
        // forwardRef: RecipesService records versions on write and VersionsService drives a recipe write
        // on restore — a deliberate two-way dependency (see RecipesService's matching forwardRef).
        //
        // The field is typed as a `Pick` of RecipesService, NOT the concrete class, ON PURPOSE — DO NOT
        // "simplify" it back to `: RecipesService`. With `emitDecoratorMetadata`, the constructor param's
        // TYPE ANNOTATION is emitted into `design:paramtypes`, which is evaluated at class-definition time.
        // A concrete-class annotation there emits a VALUE reference to RecipesService; under native ESM the
        // recipes<->versions import cycle means that binding is still in its temporal dead zone when this
        // module first evaluates, so the compiled service crashes at boot with `ReferenceError: Cannot
        // access 'RecipesService' before initialization` (it only surfaces in the COMPILED image — tsx/
        // vitest transpile the cycle differently, so tests don't catch it). A `Pick<…>` is a structural
        // type with no runtime value, so `design:paramtypes` emits `Object` and the cycle boots — while
        // `forwardRef(() => RecipesService)` (lazy arrow, evaluated later) still resolves the real instance.
        @Inject(forwardRef(() => RecipesService)) private readonly recipes: Pick<RecipesService, 'getById' | 'update'>,
        @Inject(PendingArchivesDal) private readonly pendingArchives: PendingArchivesDal,
        @Inject(VERSION_ARCHIVE_READER) private readonly archiveReader: VersionArchiveReader,
    ) {}

    /**
     * Persist an immutable version snapshot, then record any versions beyond the newest
     * `VERSION_RETENTION_LIMIT` as owing S3 an archive write.
     *
     * The S3 write itself is NOT done here (FR-007b-i) — see {@link enforceRetention}.
     *
     * @returns The newly written version (wire contract).
     * @sideEffect Inserts a `recipe_versions` row and `recipe_version_pending_archives` rows.
     */
    public async createSnapshot(input: CreateSnapshotInput, tx: RecipeTx): Promise<RecipeVersion> {
        const row = await this.dal.createSnapshot(input, tx);

        await this.enforceRetention(input.recipeId, tx);

        return toRecipeVersion(row);
    }

    /** List a recipe's versions, newest-first (read-authorized — owner, or any public recipe). */
    public async list(ownerId: string, recipeId: string): Promise<RecipeVersion[]> {
        // Reuses the recipe read authorization (throws RECIPE_NOT_FOUND / NOT_OWNER as appropriate).
        await this.recipes.getById(ownerId, recipeId);

        const rows = await this.dal.listByRecipe(recipeId);

        return rows.map(toRecipeVersion);
    }

    /**
     * Fetch one version of a recipe by its 1-based `versionNumber` (read-authorized — owner, or any
     * public recipe). Versions are addressed by number, not the internal row id.
     */
    public async get(ownerId: string, recipeId: string, versionNumber: number): Promise<RecipeVersion> {
        const recipe = await this.recipes.getById(ownerId, recipeId);

        const row = await this.dal.findByRecipeAndVersion(recipeId, versionNumber);

        if (row) {
            return toRecipeVersion(row);
        }

        // W8-a.7: the version was pruned past the DB retention window → read it back TRANSPARENTLY from the
        // S3 archive, keyed under the recipe OWNER's prefix (where the archive worker wrote it). The user
        // never sees S3; Preview/Compare therefore work for ALL versions, not just the last-10 DB window.
        const archived = await this.archiveReader.read(
            recipeVersionArchiveKey({ ownerId: recipe.ownerId, recipeId, versionNumber }),
        );

        if (archived) {
            return archived;
        }

        throw recipeNotFound(recipeId);
    }

    /**
     * Restore an old version's snapshot as the recipe's new current version (owner-only), addressing the
     * source by its 1-based `versionNumber`. Applies the snapshot content to the golden recipe (bumping
     * its `currentVersion`) and records the restore as a new immutable version snapshot (which itself
     * triggers retention).
     *
     * @returns The restored recipe, the version it was restored FROM, and the new current version number.
     */
    public async restore(principal: Principal, recipeId: string, versionNumber: number): Promise<RestoreVersionResult> {
        const ownerId = principal.userId;
        const current = await this.recipes.getById(ownerId, recipeId);

        if (current.ownerId !== ownerId) {
            throw notOwner(recipeId);
        }

        const target = await this.dal.findByRecipeAndVersion(recipeId, versionNumber);

        // W8-a.7: restore works for ALL versions — an evicted target's snapshot is read from the S3 archive
        // (same transparent fallback as `get`), so a user can restore a version older than the DB window.
        let snapshot: RecipeSnapshot;

        if (target) {
            snapshot = target.snapshot as RecipeSnapshot;
        } else {
            const archived = await this.archiveReader.read(
                recipeVersionArchiveKey({ ownerId: current.ownerId, recipeId, versionNumber }),
            );

            if (!archived) {
                throw recipeNotFound(recipeId);
            }

            snapshot = archived.snapshot;
        }

        // ⛔ ONE update call, carrying what the restore's version row must say. The restore used to pass
        // `recordSnapshot: false` and then write its own version afterwards, best-effort — the single path
        // that could commit a recipe write with no version row, and the one where reconstructing history is
        // the entire point. `RecipesService.update` now records it inside the same transaction as the write.
        //
        // ⚠️ The stored snapshot is built from the POST-UPDATE aggregate, like create/update/clone, not
        // copied from the archived one (owner ruling 2026-09-06). The rebuilt body below carries no tags,
        // cuisine, difficulty, mealType or status, so copying the archive verbatim made the version row
        // assert fields the live recipe does not have. One snapshot rule now serves all four write paths.
        const updated = await this.recipes.update(
            principal,
            recipeId,
            {
                expectedVersion: current.currentVersion,
                title: snapshot.title,
                description: snapshot.description,
                servings: snapshot.servings,
                prepTimeMinutes: snapshot.prepTimeMinutes,
                cookTimeMinutes: snapshot.cookTimeMinutes,
                // Restore the snapshot's ingredient set too — otherwise the recipe reverts everything
                // EXCEPT ingredients, leaving the live recipe's current ingredients while the restore's
                // own recorded snapshot claims the old ones (recorded state diverging from actual state).
                ingredients: snapshot.ingredients.map((ingredient) => ({
                    ingredientId: ingredient.ingredientId,
                    name: ingredient.ingredientName,
                    quantity: ingredient.quantity,
                    unit: ingredient.unit,
                    ...(ingredient.displayText !== undefined ? { notes: ingredient.displayText } : {}),
                    // U26/U27 — restored too. ⛔ These are on the BASE request schema precisely so this
                    // rebuild can carry them: a create-only field could never be restored at all, and a
                    // restore that silently strips how the onion was chopped is a version history that
                    // cannot actually return the recipe to what it was.
                    ...(ingredient.preparation !== undefined ? { preparation: ingredient.preparation } : {}),
                    ...(ingredient.groupLabel !== undefined ? { groupLabel: ingredient.groupLabel } : {}),
                    // Preserve per-line user-entered nutrition (FR-007a) across a restore.
                    ...(ingredient.userCalories !== undefined ? { userCalories: ingredient.userCalories } : {}),
                    ...(ingredient.userProteinG !== undefined ? { userProteinG: ingredient.userProteinG } : {}),
                    ...(ingredient.userCarbsG !== undefined ? { userCarbsG: ingredient.userCarbsG } : {}),
                    ...(ingredient.userFatG !== undefined ? { userFatG: ingredient.userFatG } : {}),
                })),
                steps: snapshot.steps.map((step) => ({
                    instruction: step.instruction,
                    ...(step.timerSeconds !== undefined ? { timerSeconds: step.timerSeconds } : {}),
                })),
            },
            { snapshot: { changeSummary: `Restored from version ${versionNumber}`, baseVersion: versionNumber } },
        );

        return {
            recipe: updated,
            restoredFromVersion: versionNumber,
            currentVersion: updated.currentVersion,
        };
    }

    /**
     * Hand every version beyond the newest `VERSION_RETENTION_LIMIT` to the S3-archive outbox
     * (T130 / FR-007b-i). Records intent only — no S3 write, no prune.
     *
     * FR-007b-i requires that *"a user-facing recipe save MUST succeed independently of the S3
     * version-archive write"*. It previously did not: the archive PUT ran inline, inside the caller's
     * save, so S3 latency was the user's latency. The failure path was worse than it looked — a failed
     * PUT was retried only on the *next save of that same recipe*, so a version whose owner never edited
     * again was silently never archived, with no alert and no DLQ.
     *
     * The overflow is now enqueued and archived out of band by the version-archive worker. Two rules make
     * that safe, and together they are why no `deleteById` remains here:
     *
     *  - **Nothing is pruned here.** The `recipe_versions` row must survive until S3 confirms, because it
     *    holds the snapshot the retry replays. Its outbox row is `ON DELETE CASCADE` on that row, so
     *    pruning early would delete the record of the debt *and* the payload in one step. The worker
     *    prunes after the write lands — archive-before-delete, preserved across the async boundary.
     *  - **An outbox failure now FAILS THE SAVE** (owner ruling 2026-09-06). It used to be swallowed on
     *    the argument that "the save is already committed; losing an archive *attempt* is recoverable" —
     *    but the save is no longer already committed, and the attempt was not recoverable: the old
     *    comment claimed the next save re-enqueues idempotently, which is true only IF THERE IS A NEXT
     *    SAVE. A recipe whose owner never edits again never re-derived its overflow, so that version was
     *    never archived, with no alert and no DLQ. `archiveSweeper.ts` cannot help — it selects FROM this
     *    table, so it can only re-drive a row that exists.
     *
     * ⛔ AND THE CATCH COULD NOT HAVE STAYED ANYWAY. Postgres puts a transaction into the aborted state
     * on any statement error: every later statement fails and the COMMIT degrades to a ROLLBACK. A
     * `try/catch` here would read exactly like the old code, pass every mocked unit test, and silently
     * discard the user's entire save. Swallowing inside a transaction requires a SAVEPOINT
     * (`tx.transaction`), which is deliberately NOT used — no failure mode reaching this insert alone
     * could be constructed (`ON CONFLICT DO NOTHING` against an FK target inserted in the same
     * transaction; a racing inserter blocks then no-ops at READ COMMITTED).
     *
     * @param recipeId - The recipe whose overflow to record.
     * @param tx - The open transaction carrying the recipe write and its version row.
     * @sideEffect Inserts `recipe_version_pending_archives` rows.
     */
    private async enforceRetention(recipeId: string, tx: RecipeTx): Promise<void> {
        const overflow = await this.dal.findVersionsBeyondRetention(recipeId, tx);

        await this.pendingArchives.enqueueMany(
            overflow.map((version) => ({
                recipeVersionId: version.id,
                recipeId: version.recipeId,
                versionNumber: version.versionNumber,
            })),
            tx,
        );
    }
}
