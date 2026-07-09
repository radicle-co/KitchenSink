/**
 * T030 — the recipe-version data-access layer.
 *
 * Owns every SQL touch of the immutable `recipe_versions` snapshot history (defined in
 * `database/schema/versions.ts`). It is authorization-agnostic: ownership (`NOT_OWNER`) and the S3
 * archive orchestration live in {@link VersionsService}. The DAL's three load-bearing responsibilities:
 *   1. **Snapshot create** — insert one immutable `recipe_versions` row from a captured snapshot.
 *   2. **List by recipe** — every version for a recipe, newest-first (`version_number DESC`).
 *   3. **Retention query** — the versions BEYOND the newest 10 (FR-007b): `ORDER BY version_number DESC
 *      OFFSET 10` returns exactly the rows the service archives to S3 and prunes from Postgres.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { desc, eq } from 'drizzle-orm';
import type { RecipeSnapshot } from '@kitchensink/recipe-core';

import type { RecipeDrizzle } from '../../database/client.js';
import { recipeVersions, type RecipeVersionRow } from '../../database/schema/index.js';

/** How many of the newest versions are retained in Postgres; older ones live only in S3 (FR-007b). */
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
    /** S3 archive key, when the snapshot is written with its archive already in place. */
    s3Key?: string;
}

export class VersionsDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * Insert one immutable `recipe_versions` row.
     *
     * @returns The inserted row.
     * @sideEffect Inserts one `recipe_versions` row.
     */
    public async createSnapshot(input: CreateSnapshotInput): Promise<RecipeVersionRow> {
        const [row] = await this.db
            .insert(recipeVersions)
            .values({
                recipeId: input.recipeId,
                versionNumber: input.versionNumber,
                snapshot: input.snapshot,
                baseVersion: input.baseVersion ?? null,
                s3Key: input.s3Key ?? null,
                createdBy: input.createdBy,
                changeSummary: input.changeSummary ?? null,
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
     * Load one version by id.
     *
     * @returns The row, or `undefined` when no version has that id.
     * @sideEffect Reads `recipe_versions`.
     */
    public async findById(id: string): Promise<RecipeVersionRow | undefined> {
        const [row] = await this.db.select().from(recipeVersions).where(eq(recipeVersions.id, id)).limit(1);

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
        keep: number = VERSION_RETENTION_LIMIT,
    ): Promise<RecipeVersionRow[]> {
        return this.db
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
