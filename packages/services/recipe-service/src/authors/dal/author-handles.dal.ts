/**
 * The `author_handles` read-model DAL (W8-a.2 / owner decision 6) — the recipe DB's local view of user
 * display names, plus the handle-sync CONSUMER that maintains it and fans the denormalized name out.
 *
 * Two responsibilities:
 *   - **Read** ({@link findHandle}) — the write path asks "what is this user's current handle?" LOCALLY,
 *     with NO cross-service call (the rejected read-time-lookup alternative), falling back to the token
 *     claim only when no row exists yet.
 *   - **Consume** ({@link applyRename}) — a rename event (`{ userId, displayName, sourceTimestamp }`) from
 *     EITHER producer route (the Clerk `user.updated` webhook or identity's `PATCH /api/v1/users/me`) is applied
 *     MONOTONICALLY on `source_timestamp`: an older-or-equal timestamp is IGNORED (so A→B→A redelivered
 *     out of order converges to the actual latest), and a strictly-newer one updates the read model AND
 *     fans the new name out to every `recipes.author_handle` + `recipe_versions.editor_handle` the user owns.
 *
 * All of it runs in ONE transaction so the read-model update and the denormalized fan-out commit together.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { and, eq, lt, sql } from 'drizzle-orm';

import type { RecipeDrizzle } from '../../database/client.js';
import { authorHandles, recipeVersions, recipes } from '../../database/schema/index.js';

/** A rename event from a producer route — the shape both the webhook and the PATCH path publish. */
export interface HandleRename {
    /** The app-user ULID whose display name changed. */
    readonly userId: string;
    /** The user's new display name (identity's `profiles.displayName`). */
    readonly displayName: string;
    /** `profiles.updatedAt` written in the same transaction as the change — the single monotonic clock. */
    readonly sourceTimestamp: Date;
}

export class AuthorHandlesDal {
    public constructor(private readonly db: RecipeDrizzle) {}

    /**
     * The user's current display name from the read model, or `undefined` when no rename has been seen yet
     * (the write path then falls back to `deriveDisplayName(claims)`).
     *
     * @sideEffect Reads `author_handles`.
     */
    public async findHandle(userId: string): Promise<string | undefined> {
        const [row] = await this.db
            .select({ displayName: authorHandles.displayName })
            .from(authorHandles)
            .where(eq(authorHandles.userId, userId))
            .limit(1);

        return row?.displayName;
    }

    /**
     * Apply a rename event to the read model MONOTONICALLY and fan the new name out to the user's recipes +
     * versions — all in one transaction. An older-or-equal `sourceTimestamp` than the stored one is a no-op
     * (idempotent under redelivery + out-of-order delivery). Returns whether the rename was applied.
     *
     * @sideEffect Upserts `author_handles` and updates `recipes` + `recipe_versions` for the user.
     */
    public async applyRename(event: HandleRename): Promise<boolean> {
        return this.db.transaction(async (tx) => {
            // Monotonic upsert: insert when absent, else update ONLY when the incoming timestamp is strictly
            // newer. The `WHERE author_handles.source_timestamp < excluded` on the conflict target makes the
            // guard atomic — a concurrent apply of an older event cannot clobber a newer one.
            const upserted = await tx
                .insert(authorHandles)
                .values({
                    userId: event.userId,
                    displayName: event.displayName,
                    sourceTimestamp: event.sourceTimestamp,
                })
                .onConflictDoUpdate({
                    target: authorHandles.userId,
                    set: { displayName: event.displayName, sourceTimestamp: event.sourceTimestamp },
                    setWhere: lt(authorHandles.sourceTimestamp, event.sourceTimestamp),
                })
                .returning({ userId: authorHandles.userId });

            // 0 rows returned → the conflict guard rejected a stale event; nothing to fan out.
            if (upserted.length === 0) {
                return false;
            }

            await tx
                .update(recipes)
                .set({ authorHandle: event.displayName })
                .where(
                    and(
                        eq(recipes.ownerId, event.userId),
                        sql`${recipes.authorHandle} IS DISTINCT FROM ${event.displayName}`,
                    ),
                );

            await tx
                .update(recipeVersions)
                .set({ editorHandle: event.displayName })
                .where(
                    and(
                        eq(recipeVersions.createdBy, event.userId),
                        sql`${recipeVersions.editorHandle} IS DISTINCT FROM ${event.displayName}`,
                    ),
                );

            return true;
        });
    }
}
