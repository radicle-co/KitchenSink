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
import { Inject, Injectable } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { RecipeSnapshot, RecipeVersion } from '@kitchensink/recipe-core';

import { VersionsDal, type CreateSnapshotInput } from './dal/versions.dal.js';
import { RecipesService } from '../recipes/recipes.service.js';
import { notOwner, recipeNotFound } from '../recipes/recipe.error.js';
import type { RecipeVersionRow } from '../database/schema/index.js';

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

/** Deterministic S3 object key for a version archive: one immutable object per recipe/version. Pure. */
export function versionArchiveKey(row: RecipeVersionRow): string {
    return `recipes/${row.recipeId}/versions/${row.versionNumber}.json`;
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
        private readonly recipes: RecipesService,
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

    /** Fetch one version of a recipe (read-authorized — owner, or any public recipe). */
    public async get(ownerId: string, recipeId: string, versionId: string): Promise<RecipeVersion> {
        await this.recipes.getById(ownerId, recipeId);

        const row = await this.dal.findById(versionId);

        if (!row || row.recipeId !== recipeId) {
            throw recipeNotFound(versionId);
        }

        return toRecipeVersion(row);
    }

    /**
     * Restore an old version's snapshot as the recipe's new current version (owner-only). Applies the
     * snapshot content to the golden recipe (bumping its `currentVersion`) and records the restore as a
     * new immutable version snapshot (which itself triggers retention).
     *
     * @returns The new version created by the restore.
     */
    public async restore(ownerId: string, recipeId: string, versionId: string): Promise<RecipeVersion> {
        const current = await this.recipes.getById(ownerId, recipeId);

        if (current.ownerId !== ownerId) {
            throw notOwner(recipeId);
        }

        const target = await this.dal.findById(versionId);

        if (!target || target.recipeId !== recipeId) {
            throw recipeNotFound(versionId);
        }

        const snapshot = target.snapshot as RecipeSnapshot;

        const updated = await this.recipes.update(ownerId, recipeId, {
            expectedVersion: current.version,
            title: snapshot.title,
            description: snapshot.description,
            servings: snapshot.servings,
            prepTimeMinutes: snapshot.prepTimeMinutes,
            cookTimeMinutes: snapshot.cookTimeMinutes,
            steps: snapshot.steps.map((step) => ({
                instruction: step.instruction,
                ...(step.timerSeconds !== undefined ? { timerSeconds: step.timerSeconds } : {}),
            })),
        });

        return this.createSnapshot({
            recipeId,
            versionNumber: updated.version,
            snapshot: { ...snapshot, version: updated.version },
            createdBy: ownerId,
            baseVersion: target.versionNumber,
            changeSummary: `Restored from version ${target.versionNumber}`,
        });
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
            await this.archive(version);
            await this.dal.deleteById(version.id);
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
