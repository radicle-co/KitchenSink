/**
 * T031 — recipe-version orchestration: snapshot writes and retention enqueue (NOT S3 archiving — that
 * moved to the async version-archive worker in T130; see {@link enforceRetention}).
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
import { deriveDisplayName } from '@kitchensink/identity-core';
import { recipeVersionArchiveKey } from '@kitchensink/recipe-core';
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsDal, type CreateSnapshotInput } from './dal/versions.dal.js';
import { PendingArchivesDal } from './dal/pending-archives.dal.js';
import { VERSION_ARCHIVE_READER, type VersionArchiveReader } from './version-archive.storage.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner, recipeNotFound } from '../recipes/recipe.error.js';
import type { Principal } from '../auth/principal.js';
import type { RecipeResponse } from '../recipes/dto/recipe-response.dto.js';
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
        snapshot: row.snapshot as RecipeSnapshot,
        ...(row.baseVersion !== null ? { baseVersion: row.baseVersion } : {}),
        ...(row.s3Key !== null ? { s3Key: row.s3Key } : {}),
        createdBy: row.createdBy,
        ...(row.changeSummary !== null ? { changeSummary: row.changeSummary } : {}),
        // Device attribution (W8-a.6) — OMITTED (not null) when unknown; the UI renders "unknown device".
        ...(row.deviceLabel !== null ? { deviceLabel: row.deviceLabel } : {}),
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
     * {@link VERSION_RETENTION_LIMIT} as owing S3 an archive write.
     *
     * The S3 write itself is NOT done here (FR-007b-i) — see {@link enforceRetention}.
     *
     * @returns The newly written version (wire contract).
     * @sideEffect Inserts a `recipe_versions` row and `recipe_version_pending_archives` rows.
     */
    public async createSnapshot(input: CreateSnapshotInput): Promise<RecipeVersion> {
        const row = await this.dal.createSnapshot(input);

        await this.enforceRetention(input.recipeId);

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

        // recordSnapshot:false — the restore records its OWN version below (with baseVersion + a restore
        // summary), so the update must not also auto-snapshot, or the restore would write two versions at
        // the same number.
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
            { recordSnapshot: false },
        );

        // Editor handle (W8-a.2): the RESTORER is the editor of this new version — derived from their
        // claims via the ONE shared rule (matching create/update/clone); omitted → NULL when not derivable.
        const editorHandle = deriveDisplayName(principal) || undefined;

        // Record the restore as its own immutable version (with restore provenance) — this also drives
        // retention. The RESPONSE is the restored recipe + version metadata, not this snapshot row.
        //
        // Best-effort (the SAME convention as `RecipesService.recordSnapshot`): the `recipes.update` call
        // above has ALREADY committed the recipe content, so a snapshot-write failure here must not
        // surface as a 500 on an otherwise-successful restore — it is logged and swallowed, not rethrown.
        // The reconciliation/worker path backstops a missed row, same as create/update/clone.
        try {
            await this.createSnapshot({
                recipeId,
                versionNumber: updated.currentVersion,
                snapshot: { ...snapshot, version: updated.currentVersion },
                createdBy: ownerId,
                baseVersion: versionNumber,
                changeSummary: `Restored from version ${versionNumber}`,
                ...(editorHandle !== undefined ? { editorHandle } : {}),
            });
        } catch (error) {
            // The recipe is saved; a version-history hiccup is non-fatal to the restore. Surface it for
            // observability (logs route to Sentry) without propagating.
            console.error(`Failed to record version snapshot for recipe ${recipeId}:`, error);
        }

        return {
            recipe: updated,
            restoredFromVersion: versionNumber,
            currentVersion: updated.currentVersion,
        };
    }

    /**
     * Hand every version beyond the newest {@link VERSION_RETENTION_LIMIT} to the S3-archive outbox
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
     *  - **An outbox failure never fails the save.** The save is already committed; losing an archive
     *    *attempt* is recoverable, failing the user's write is not.
     *
     * @sideEffect Inserts `recipe_version_pending_archives` rows.
     */
    private async enforceRetention(recipeId: string): Promise<void> {
        const overflow = await this.dal.findVersionsBeyondRetention(recipeId);

        for (const version of overflow) {
            try {
                await this.pendingArchives.enqueue({
                    recipeVersionId: version.id,
                    recipeId: version.recipeId,
                    versionNumber: version.versionNumber,
                });
            } catch {
                // Swallowed by design (FR-007b-i). `findVersionsBeyondRetention` re-derives the overflow
                // from scratch on every save and `enqueue` is idempotent, so the next save of this recipe
                // re-enqueues it. Nothing is lost; only the archive is delayed.
            }
        }
    }
}
