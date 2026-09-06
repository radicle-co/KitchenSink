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
import type { RecipeTx } from '../../database/unitOfWork.js';
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
     * Record that every given version owes S3 an archive write, in ONE statement. Idempotent.
     *
     * `UNIQUE(recipe_version_id)` + `ON CONFLICT DO NOTHING` means enqueueing the same version twice
     * leaves exactly one row, so a re-run retention pass (or a replayed save) cannot fan out duplicate
     * archive work. `status`, `attempts`, and `next_attempt_at` are deliberately left to the migration's
     * DEFAULTs so the initial state has one authoritative definition.
     *
     * ⛔ THE WRITER IS A REQUIRED PARAMETER, not an optional one defaulting to the injected client. This
     * row is the record of a debt the `recipe_versions` row incurs, and the Outbox pattern's contract is
     * that the intent record commits with the state change it describes. Making the transaction handle
     * required turns "an outbox row written outside its save's transaction" into a compile error rather
     * than a convention — a default here would be a POSITION, silently asserted for every caller that had
     * not thought about it.
     *
     * ⚠️ An empty input issues NO statement, because drizzle throws on `.values([])` — and `enforceRetention`
     * calls this on EVERY save, where the overflow is empty for every recipe with ten versions or fewer.
     * The guard covers the common path, not an edge case.
     *
     * @param inputs - The versions that owe an archive write; empty is a legitimate no-op.
     * @param tx - The open transaction this write must join.
     * @returns The rows actually inserted (conflicts contribute nothing).
     * @sideEffect Inserts into `recipe_version_pending_archives`.
     */
    public async enqueueMany(
        inputs: readonly EnqueueArchiveInput[],
        tx: RecipeTx,
    ): Promise<RecipeVersionPendingArchiveRow[]> {
        if (inputs.length === 0) {
            return [];
        }

        return tx
            .insert(recipeVersionPendingArchives)
            .values(
                inputs.map((input) => ({
                    recipeVersionId: input.recipeVersionId,
                    recipeId: input.recipeId,
                    versionNumber: input.versionNumber,
                })),
            )
            .onConflictDoNothing()
            .returning();
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
