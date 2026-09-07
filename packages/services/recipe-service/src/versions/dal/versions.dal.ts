/**
 * T030 — the recipe-version data-access layer.
 *
 * Owns every SQL touch of the immutable `recipe_versions` snapshot history (defined in
 * `database/schema/versions.ts`). It is authorization-agnostic: ownership (`NOT_OWNER`) and the
 * retention orchestration live in `VersionsService`. The DAL's three load-bearing responsibilities:
 *   1. **Snapshot create** — insert one immutable `recipe_versions` row from a captured snapshot.
 *   2. **List by recipe** — every version for a recipe, newest-first (`version_number DESC`).
 *   3. **Retention query** — the versions BEYOND the newest 10 (FR-007b): `ORDER BY version_number DESC
 *      OFFSET 10` returns exactly the rows the service records in the archive outbox. Post-T130 the DAL
 *      does NOT prune them and the service does NOT write S3 — the version-archive worker archives each
 *      to S3 and only then prunes it (archive-before-delete, across the async boundary).
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/client.js';
import type { RecipeTx } from '../../database/unitOfWork.js';
import { recipeVersions, type RecipeVersionRow } from '../../database/schema/index.js';

/**
 * How many of the newest versions Postgres retains as the "hot" window (FR-007b). Older ones are NOT
 * deleted at save time (T130): they are recorded in the archive outbox and only pruned by the
 * version-archive worker once their S3 archive confirms — so they end up living only in S3.
 */
export const VERSION_RETENTION_LIMIT = 10;

/** Everything the DAL needs to insert one immutable version snapshot row. */
export interface CreateSnapshotInput {
    recipeId: string;
    versionNumber: number;
    /** The full recipe content captured at this version (persisted as `jsonb`). */
    snapshot: RecipeSnapshot;
    /** App-user ULID of the author (token claim; no FK, no local users table — D2). */
    createdBy: string;
    /** The version this snapshot was based on (enables 3-way merge conflict detection). */
    baseVersion?: number;
    changeSummary?: string;
    /** The editor's denormalized display name (W8-a.2) — from the claim/read-model; omitted → NULL. */
    editorHandle?: string;
    /** S3 archive key, when the snapshot is written with its archive already in place. */
    s3Key?: string;
}

export class VersionsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Insert one immutable `recipe_versions` row, in the caller's transaction.
     *
     * ⛔ THE TRANSACTION IS REQUIRED, and not defaulted to the injected client. A recipe save and its
     * version row commit together or not at all (owner ruling 2026-09-06), so a version written outside
     * a transaction is the exact defect this parameter exists to prevent — and a default would be a
     * POSITION, silently asserted for every caller that had not thought about it. Required makes it a
     * compile error instead of a convention.
     *
     * @param input - The snapshot to record.
     * @param tx - The open transaction that also carries the recipe write.
     * @returns The inserted row.
     * @sideEffect Inserts one `recipe_versions` row.
     */
    public async createSnapshot(input: CreateSnapshotInput, tx: RecipeTx): Promise<RecipeVersionRow> {
        const [row] = await tx
            .insert(recipeVersions)
            .values({
                recipeId: input.recipeId,
                versionNumber: input.versionNumber,
                snapshot: input.snapshot,
                baseVersion: input.baseVersion ?? null,
                s3Key: input.s3Key ?? null,
                createdBy: input.createdBy,
                changeSummary: input.changeSummary ?? null,
                editorHandle: input.editorHandle ?? null,
            })
            .returning();

        if (!row) {
            throw new Error('VersionsDal.createSnapshot: insert returned no recipe_versions row');
        }

        return row;
    }

    /**
     * List every version for a recipe, newest-first.
     *
     * @sideEffect Reads `recipe_versions`.
     */
    public async listByRecipe(recipeId: string): Promise<RecipeVersionRow[]> {
        return this.db
            .select()
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, recipeId))
            .orderBy(desc(recipeVersions.versionNumber));
    }

    /**
     * Load one version of a recipe by its 1-based `versionNumber` (the client-facing address — versions
     * are addressed by number, not the internal row id). Scoped by `recipeId` so a number is only ever
     * resolved within its own recipe; uses the `(recipe_id, version_number)` unique index.
     *
     * @returns The row, or `undefined` when the recipe has no version with that number.
     * @sideEffect Reads `recipe_versions`.
     */
    public async findByRecipeAndVersion(
        recipeId: string,
        versionNumber: number,
    ): Promise<RecipeVersionRow | undefined> {
        const [row] = await this.db
            .select()
            .from(recipeVersions)
            .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.versionNumber, versionNumber)))
            .limit(1);

        return row;
    }

    /**
     * Find every version BEYOND the newest `keep` for a recipe — the retention overflow the service
     * archives to S3 and then prunes from Postgres. Newest-first ordering is required so `OFFSET keep`
     * skips the versions to KEEP and returns the ones to prune (FR-007b).
     *
     * @param recipeId - The recipe whose overflow versions to load.
     * @param keep - How many newest versions to retain (defaults to {@link VERSION_RETENTION_LIMIT}).
     * @returns The overflow rows (newest-first), or an empty array when at or under the limit.
     * @sideEffect Reads `recipe_versions`.
     */
    public async findVersionsBeyondRetention(
        recipeId: string,
        tx: RecipeTx,
        keep: number = VERSION_RETENTION_LIMIT,
    ): Promise<RecipeVersionRow[]> {
        return tx
            .select()
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, recipeId))
            .orderBy(desc(recipeVersions.versionNumber))
            .offset(keep);
    }

    /**
     * Delete one version row (used to prune retention overflow after it is archived to S3).
     *
     * @sideEffect Deletes one `recipe_versions` row.
     */
    public async deleteById(id: string): Promise<void> {
        await this.db.delete(recipeVersions).where(eq(recipeVersions.id, id));
    }
}
