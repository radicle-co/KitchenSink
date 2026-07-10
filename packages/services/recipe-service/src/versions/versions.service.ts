/**
 * T031 — recipe-version orchestration: snapshot writes, DB retention, and S3 archiving.
 *
 * Sits between the controller and the {@link VersionsDal}. It owns the rules the DAL delegates upward:
 * - **Snapshot write** — persist an immutable version row and shape it to the `RecipeVersion` wire
 *   contract.
 * - **Retention (FR-007b)** — Postgres keeps only the newest 10 versions of a recipe; on every write,
 *   versions beyond the limit are archived to the `S3_BUCKET_VERSIONS` bucket and then pruned from the
 *   DB (archive FIRST, delete SECOND, so a snapshot is never lost).
 * - **Read + restore** — list/get a recipe's versions (read-authorized through {@link RecipesService}),
 *   and restore an old snapshot as a new current version (owner-only).
 *
 * The S3 client is injected (a provider token), so unit tests pass a `{ send }` mock and never touch AWS.
 * Ownership is ALWAYS the app-user ULID, never the Clerk `sub` (D2).
 */
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsDal, type CreateSnapshotInput } from './dal/versions.dal.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner, recipeNotFound } from '../recipes/recipe.error.js';
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

/** DI token for the injected S3 client (the archive writer). */
export const VERSIONS_S3_CLIENT = 'VERSIONS_S3_CLIENT';

/** DI token for the `S3_BUCKET_VERSIONS` bucket name. */
export const VERSIONS_S3_BUCKET = 'VERSIONS_S3_BUCKET';

/** The minimal S3 surface the service depends on — satisfied by both `S3Client` and a `{ send }` mock. */
export interface VersionArchiveS3 {
    send(command: PutObjectCommand): Promise<unknown>;
}

/**
 * Deterministic S3 object key for a version archive: one immutable object per recipe/version.
 *
 * The key MUST be under the owner prefix `recipes/{ownerId}/…` (ownerId = the version's `createdBy`, the
 * app-user ULID — mutations are owner-only, so it equals the recipe owner). GDPR account erasure sweeps
 * exactly `recipes/{ownerId}/` (the erasure worker's `ownerMediaPrefix`); a key WITHOUT the owner segment
 * (the old `recipes/{recipeId}/versions/…`) escaped that sweep and survived erasure — a compliance defect
 * (verticals-8). This is the single in-service scheme; the shared `recipeObjectKeys` unification with the
 * archive worker (ARCH-BE-3, still on versionId vs versionNumber) is the follow-up. Pure.
 */
export function versionArchiveKey(row: RecipeVersionRow): string {
    return `recipes/${row.createdBy}/${row.recipeId}/versions/${row.versionNumber}.json`;
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
        createdAt: row.createdAt.toISOString(),
    };
}

@Injectable()
export class VersionsService {
    public constructor(
        @Inject(VERSIONS_DAL) private readonly dal: VersionsDal,
        // forwardRef: RecipesService records versions on write and VersionsService drives a recipe write
        // on restore — a deliberate two-way dependency (see RecipesService's matching forwardRef).
        @Inject(forwardRef(() => RecipesService)) private readonly recipes: RecipesService,
        @Inject(VERSIONS_S3_CLIENT) private readonly s3: VersionArchiveS3,
        @Inject(VERSIONS_S3_BUCKET) private readonly bucket: string,
    ) {}

    /**
     * Persist an immutable version snapshot, then enforce retention: archive + prune everything beyond
     * the newest {@link VERSION_RETENTION_LIMIT} versions.
     *
     * @returns The newly written version (wire contract).
     * @sideEffect Inserts a `recipe_versions` row, PUTs archive objects to S3, and deletes pruned rows.
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
        await this.recipes.getById(ownerId, recipeId);

        const row = await this.dal.findByRecipeAndVersion(recipeId, versionNumber);

        if (!row) {
            throw recipeNotFound(recipeId);
        }

        return toRecipeVersion(row);
    }

    /**
     * Restore an old version's snapshot as the recipe's new current version (owner-only), addressing the
     * source by its 1-based `versionNumber`. Applies the snapshot content to the golden recipe (bumping
     * its `currentVersion`) and records the restore as a new immutable version snapshot (which itself
     * triggers retention).
     *
     * @returns The restored recipe, the version it was restored FROM, and the new current version number.
     */
    public async restore(ownerId: string, recipeId: string, versionNumber: number): Promise<RestoreVersionResult> {
        const current = await this.recipes.getById(ownerId, recipeId);

        if (current.ownerId !== ownerId) {
            throw notOwner(recipeId);
        }

        const target = await this.dal.findByRecipeAndVersion(recipeId, versionNumber);

        if (!target) {
            throw recipeNotFound(recipeId);
        }

        const snapshot = target.snapshot as RecipeSnapshot;

        // recordSnapshot:false — the restore records its OWN version below (with baseVersion + a restore
        // summary), so the update must not also auto-snapshot, or the restore would write two versions at
        // the same number.
        const updated = await this.recipes.update(
            ownerId,
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

        // Record the restore as its own immutable version (with restore provenance) — this also drives
        // retention. The RESPONSE is the restored recipe + version metadata, not this snapshot row.
        await this.createSnapshot({
            recipeId,
            versionNumber: updated.currentVersion,
            snapshot: { ...snapshot, version: updated.currentVersion },
            createdBy: ownerId,
            baseVersion: target.versionNumber,
            changeSummary: `Restored from version ${target.versionNumber}`,
        });

        return {
            recipe: updated,
            restoredFromVersion: target.versionNumber,
            currentVersion: updated.currentVersion,
        };
    }

    /**
     * Archive + prune every version beyond the newest {@link VERSION_RETENTION_LIMIT}. Each overflow
     * version is written to S3 FIRST and only then deleted from Postgres.
     *
     * @sideEffect PUTs archive objects to S3 and deletes pruned `recipe_versions` rows.
     */
    private async enforceRetention(recipeId: string): Promise<void> {
        const overflow = await this.dal.findVersionsBeyondRetention(recipeId);

        for (const version of overflow) {
            // Archive-before-delete is the safety invariant: only prune a row once its snapshot is safely
            // in S3. If the archive PUT fails, LEAVE the row in Postgres and stop — never delete an
            // un-archived version, and never let a transient S3 error 500 the recipe save that already
            // committed. The row is simply re-attempted on the next write (and the durable retry path is
            // the pending-archive queue, T131). A `deleteById` failure is likewise swallowed to keep the
            // save succeeding; the row just remains for the next pass.
            try {
                await this.archive(version);
            } catch {
                return;
            }

            try {
                await this.dal.deleteById(version.id);
            } catch {
                // Row stays; a later retention pass prunes it. The snapshot is already archived, so safe.
            }
        }
    }

    /** Write one immutable version-archive object to the `S3_BUCKET_VERSIONS` bucket. */
    private async archive(version: RecipeVersionRow): Promise<void> {
        await this.s3.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: versionArchiveKey(version),
                ContentType: 'application/json',
                Body: JSON.stringify(toRecipeVersion(version)),
            }),
        );
    }
}
