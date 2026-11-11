/**
 * THE BULK IMPORT PURGE (ADR-0072 §9, owner ruling 2026-10-26) — an import's working data is deleted 30 days after the
 * import finishes or is abandoned. The recipes it saved stay.
 *
 * DESIGN PATTERN: **Retention sweep** hosted on the band drain's 15-minute tick, beside `expireParseJobs` (the same
 * precedent, for the same reason): a Lambda of its own would be a new ADR-0004 NAT consumer and a new schedule rule that
 * ADR-0060 and ADR-0061 would then govern, for one indexed DELETE. On the drain's tick it inherits both.
 *
 * ## What "finishes or is abandoned" means here
 *
 * One clock: `recipe_imports.updated_at`, the import's last activity (ADR-0072 §9 states it as the last `advance`). A
 * finished import ages from its last save, an abandoned one from the last time the cook touched it, and a live one never
 * reaches the bound. There is no second "finished" flag to keep in step with the first.
 *
 * ## What goes, and what stays
 *
 * The header row goes, and the foreign keys carry the rest: the items and the snapshot lines CASCADE. A saved recipe stays,
 * and its ingredient's `import_line_id` becomes NULL (`ON DELETE SET NULL`): the link was provenance only, and `bound_by`
 * stays. The allowance ledger (`import_allowance_events`) is NOT touched and nothing is refunded: a purge is retention, not
 * a reversal of a day's spend, and the ledger prunes itself by its own 24-hour edge.
 *
 * ⚠️ ACCEPTED CONSEQUENCE, stated rather than discovered: the library-wide "to check" list is derived from the snapshot, so
 * a line still waiting for a decision when its import is purged leaves that list. The saved recipe keeps the line as the
 * import left it. Recorded as open for the owner in ADR-0072, Residual risks.
 *
 * ## Shape of the work
 *
 * Batches, because a first run after a long outage could delete a great many imports with their lines in one statement and
 * hold row locks for all of it. Each batch is its own statement and transaction; a tick stops at a short batch or at
 * {@link IMPORT_PURGE_MAX_BATCHES_PER_TICK}, and what remains waits for the next tick (the oldest first, by the index on
 * `updated_at`). A failure is NOT swallowed: the data is user content past its retention bound, so the tick must fail
 * loudly (the handler runs this LAST, so a failure costs the other sweeps nothing).
 */
import type { ExpiryQueryable } from '../parsing/parseJobExpiry.js';

/** How long an import's working data is kept after its last activity (`updated_at`). */
export const IMPORT_PURGE_AFTER_DAYS = 30;

/**
 * Imports deleted per statement. Each import cascades to its items and its snapshot lines (and sets the link on each saved
 * ingredient to NULL), so a batch is bounded by ROWS only roughly: the batch is small because an import can hold thousands of
 * recipes. One import with tens of thousands of recipes could still make a single statement exceed the host's time (ADR-0072,
 * Residual risks): a file of any size is accepted (§8), so the allowance does not bound one import's size.
 */
export const IMPORT_PURGE_BATCH_SIZE = 3;

/** The most batches one tick runs, a hard stop beside the time budget. */
export const IMPORT_PURGE_MAX_BATCHES_PER_TICK = 100;

/**
 * How long one tick spends deleting, checked between batches. The host Lambda has 60 seconds for the drain, the parse-job
 * sweep and this, so the purge keeps to a third; what remains waits for the next tick (15 minutes later), oldest first.
 */
export const IMPORT_PURGE_TIME_BUDGET_MS = 20_000;

/**
 * Delete the working data of every import whose last activity (`updated_at`) is older than {@link IMPORT_PURGE_AFTER_DAYS}.
 *
 * @param pool - The recipe database pool.
 * @param clock - Milliseconds now. Injected so the time budget is testable.
 * @returns How many imports were deleted this tick.
 * @sideEffect Deletes `recipe_imports` rows; the items and snapshot lines cascade; ingredient links are set to NULL.
 */
export async function purgeFinishedImports(pool: ExpiryQueryable, clock: () => number = Date.now): Promise<number> {
    const startedAt = clock();
    let deleted = 0;

    for (let batch = 0; batch < IMPORT_PURGE_MAX_BATCHES_PER_TICK; batch += 1) {
        const result = await pool.query(
            `WITH gone AS (
                 DELETE FROM recipe_imports
                  WHERE id IN (
                      SELECT id FROM recipe_imports
                       WHERE updated_at < now() - ($1 || ' days')::interval
                       ORDER BY updated_at
                       LIMIT $2
                  )
              RETURNING 1
             )
             SELECT count(*)::int AS n FROM gone`,
            [String(IMPORT_PURGE_AFTER_DAYS), IMPORT_PURGE_BATCH_SIZE],
        );
        const count = Number((result.rows[0] as { n: number | string } | undefined)?.n ?? 0);

        deleted += count;

        if (count < IMPORT_PURGE_BATCH_SIZE || clock() - startedAt >= IMPORT_PURGE_TIME_BUDGET_MS) {
            return deleted;
        }
    }

    return deleted;
}
