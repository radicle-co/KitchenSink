/**
 * T130 — the data-access layer for `recipe_version_pending_archives`, the FR-007b-i S3-archive outbox.
 *
 * This table is an **outbox**, not a queue mirror. A pending row means "this version still owes S3 a
 * write", and it — together with the `recipe_versions` row it references — IS the durable payload
 * FR-007b-i requires be *"persisted locally so retries can replay the exact failed payload"*. That is
 * why the table has no snapshot column: duplicating the snapshot would create a second source of truth
 * that could disagree with the row it copied.
 *
 * Two consequences worth stating, because they are what make the whole async path safe:
 *
 *  - **The row outlives the SQS message.** The message is a latency optimisation; the row is the
 *    record. If an enqueue fails, or a message is lost, the row remains claimable via
 *    `idx_pending_archives_status_next` (`status IN ('pending','failed')`) and a sweeper re-drives it.
 *    So a recipe save never depends on SQS being reachable, exactly as FR-007b-i demands.
 *  - **The version row must NOT be pruned until S3 confirms.** `recipe_version_id` is
 *    `ON DELETE CASCADE`, so deleting the version row silently deletes its pending row — destroying the
 *    outbox record and the payload in one step. Retention pruning is therefore the archive worker's job,
 *    after the S3 write succeeds, never the writer's.
 *
 * @sideEffect Every method reads and/or writes Postgres via the injected Drizzle client.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DrizzleProvider } from '../../database/database.module.js';
import type { RecipeDrizzle } from '../../database/client.js';
import { recipeVersionPendingArchives, type RecipeVersionPendingArchiveRow } from '../../database/schema/index.js';

/** Everything needed to record that a version owes S3 an archive write. */
export interface EnqueueArchiveInput {
    /** The `recipe_versions.id` whose snapshot must be archived — the outbox's unique key. */
    readonly recipeVersionId: string;
    /** The owning recipe (denormalized so a per-recipe backlog can be read without a join). */
    readonly recipeId: string;
    /**
     * The client-facing version number.
     *
     * Carried on the row because it is what the archive object is KEYED by (ARCH-BE-3,
     * `recipeVersionArchiveKey`), so the worker can build the key without re-reading the version row.
     */
    readonly versionNumber: number;
}

@Injectable()
export class PendingArchivesDal {
    public constructor(@Inject(DrizzleProvider) private readonly db: RecipeDrizzle) {}

    /**
     * Record that a version owes S3 an archive write. Idempotent.
     *
     * `UNIQUE(recipe_version_id)` + `ON CONFLICT DO NOTHING` means enqueueing the same version twice
     * leaves exactly one row, so a re-run retention pass (or a replayed save) cannot fan out duplicate
     * archive work. `status`, `attempts`, and `next_attempt_at` are deliberately left to the migration's
     * DEFAULTs so the initial state has one authoritative definition.
     *
     * @returns The inserted row, or `undefined` when one already existed (the idempotent no-op).
     * @sideEffect Inserts into `recipe_version_pending_archives`.
     */
    public async enqueue(input: EnqueueArchiveInput): Promise<RecipeVersionPendingArchiveRow | undefined> {
        const [row] = await this.db
            .insert(recipeVersionPendingArchives)
            .values({
                recipeVersionId: input.recipeVersionId,
                recipeId: input.recipeId,
                versionNumber: input.versionNumber,
            })
            .onConflictDoNothing()
            .returning();

        return row;
    }

    /**
     * The number of outstanding archive rows — the backlog FR-007b-i bounds at 100 and T138 alarms on.
     *
     * @returns The count (`0` when the outbox is drained).
     * @sideEffect Reads `recipe_version_pending_archives`.
     */
    public async countPending(): Promise<number> {
        const rows = await this.db.select({ count: sql<number>`count(*)::int` }).from(recipeVersionPendingArchives);

        return rows[0]?.count ?? 0;
    }
}
