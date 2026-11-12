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
 * hold row locks for all of it. Each batch is its own transaction; a tick stops at a short batch or at
 * {@link IMPORT_PURGE_MAX_BATCHES_PER_TICK}, and what remains waits for the next tick (the oldest first, by the index on
 * `updated_at`). The rows are taken `FOR UPDATE SKIP LOCKED`: an import another transaction holds (the cook's write) is
 * skipped, not waited for and not deleted under it, and under READ COMMITTED a row whose `updated_at` moved before the lock
 * is re-checked against the age bound before it is taken. The next tick sees a skipped import again.
 *
 * SKIP LOCKED covers the import rows only. The cascade also sets `ingredients.import_line_id` to NULL, and that update WAITS
 * on a cook's lock on the ingredient row. So each batch sets a transaction-local `lock_timeout`
 * ({@link IMPORT_PURGE_LOCK_TIMEOUT_MS}): a batch that waits that long is rolled back, the tick stops there and keeps what
 * earlier batches deleted, and the next tick tries again. That is a quiet stop, not a failure, because a cook's edit is
 * normal; a lock that never clears shows as the oldest import's age, which the alarm watches. Any other failure is NOT
 * swallowed: the data is user content past its retention bound, so the tick must fail loudly.
 *
 * ## What an operator sees
 *
 * {@link runImportPurge} publishes two metrics with `Stage` (ADR-0062) on every tick: how many imports it deleted, zero
 * included, and the age of the oldest import still held. The age is read and published FIRST, before any delete, so a purge
 * that fails, hangs or has fallen behind still shows as an age past the bound; `BulkImportPurgeBehindAlarm` watches it.
 */
import type { EmfMetric } from '../common/metrics.js';
import { logger } from '../common/logger.js';
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

/**
 * The purge's metrics.
 *
 * ⛔ The namespace and the age name MUST EQUAL `IMPORT_METRIC_NAMESPACE` and `OLDEST_IMPORT_AGE_METRIC_NAME` in
 * `infra/lib/RecipeWorkersStack.ts`, whose alarm watches the age: a divergence fails nothing at deploy time and leaves the
 * alarm watching a metric nobody publishes. `serviceInfraWiringInvariants` W3 checks that the alarmed name is emitted; the
 * namespace is paired by this comment. The purged count has no alarm, so it has no twin there.
 */
export const IMPORT_METRIC_NAMESPACE = 'Commise/RecipeImport';
export const IMPORTS_PURGED_METRIC_NAME = 'BulkImportsPurged';
export const OLDEST_IMPORT_AGE_METRIC_NAME = 'OldestBulkImportAgeSeconds';

/**
 * How long one batch waits for a row lock before it gives up (transaction-local, so the pooled connection keeps nothing).
 * Well under the time budget below, so the worst tick is the budget plus one wait, inside the host's 60 seconds.
 */
export const IMPORT_PURGE_LOCK_TIMEOUT_MS = 5_000;

/** Postgres `lock_not_available`: the SQLSTATE a statement fails with when it waits past `lock_timeout`. */
const LOCK_NOT_AVAILABLE = '55P03';

/** The most batches one tick runs, a hard stop beside the time budget. */
export const IMPORT_PURGE_MAX_BATCHES_PER_TICK = 100;

/**
 * How long one tick spends deleting, checked between batches. The host Lambda has 60 seconds for the drain, the parse-job
 * sweep and this, so the purge keeps to a third; what remains waits for the next tick (15 minutes later), oldest first.
 */
export const IMPORT_PURGE_TIME_BUDGET_MS = 20_000;

/**
 * The purge's database surface: queries on the pool (the age read), and a client of its own for the batches, because a
 * transaction-local setting needs every statement of its transaction on one connection. `pg.Pool` satisfies it.
 */
export interface ImportPurgePool extends ExpiryQueryable {
    connect(): Promise<ExpiryQueryable & { release(destroy?: Error | boolean): void }>;
}

/**
 * Delete the working data of every import whose last activity (`updated_at`) is older than {@link IMPORT_PURGE_AFTER_DAYS}.
 *
 * @param pool - The recipe database pool.
 * @param clock - Milliseconds now. Injected so the time budget is testable.
 * @returns How many imports were deleted this tick.
 * @sideEffect Deletes `recipe_imports` rows; the items and snapshot lines cascade; ingredient links are set to NULL.
 */
export async function purgeFinishedImports(pool: ImportPurgePool, clock: () => number = Date.now): Promise<number> {
    const startedAt = clock();
    const client = await pool.connect();
    let deleted = 0;
    let failure: Error | undefined;

    try {
        for (let batch = 0; batch < IMPORT_PURGE_MAX_BATCHES_PER_TICK; batch += 1) {
            const count = await purgeOneBatch(client);

            if (count === undefined) {
                logger.warn('bulk import purge waited past its lock timeout; the rest waits for the next tick', {
                    deleted,
                });

                return deleted;
            }

            deleted += count;

            if (count < IMPORT_PURGE_BATCH_SIZE || clock() - startedAt >= IMPORT_PURGE_TIME_BUDGET_MS) {
                return deleted;
            }
        }

        return deleted;
    } catch (error) {
        // A connection whose transaction failed is destroyed, not handed back to the pool in an unknown state.
        failure = error instanceof Error ? error : new Error(String(error));

        throw error;
    } finally {
        client.release(failure);
    }
}

/**
 * One batch in its own transaction, with a transaction-local lock timeout.
 *
 * @param client - A connection the caller holds for the whole purge.
 * @returns How many imports it deleted, or `undefined` when it waited past {@link IMPORT_PURGE_LOCK_TIMEOUT_MS} and was
 *   rolled back.
 * @sideEffect Deletes `recipe_imports` rows (see {@link purgeFinishedImports}).
 */
async function purgeOneBatch(client: ExpiryQueryable): Promise<number | undefined> {
    await client.query('BEGIN', []);

    try {
        // `set_config(..., true)` is `SET LOCAL` with a bound parameter: it ends with this transaction.
        await client.query(`SELECT set_config('lock_timeout', $1, true)`, [`${IMPORT_PURGE_LOCK_TIMEOUT_MS}ms`]);

        const result = await client.query(
            `WITH gone AS (
                 DELETE FROM recipe_imports
                  WHERE id IN (
                      SELECT id FROM recipe_imports
                       WHERE updated_at < now() - ($1 || ' days')::interval
                       ORDER BY updated_at
                       LIMIT $2
                         FOR UPDATE SKIP LOCKED
                  )
              RETURNING 1
             )
             SELECT count(*)::int AS n FROM gone`,
            [String(IMPORT_PURGE_AFTER_DAYS), IMPORT_PURGE_BATCH_SIZE],
        );

        await client.query('COMMIT', []);

        return Number((result.rows[0] as { n: number | string } | undefined)?.n ?? 0);
    } catch (error) {
        await client.query('ROLLBACK', []);

        if ((error as { code?: unknown } | null)?.code === LOCK_NOT_AVAILABLE) {
            return undefined;
        }

        throw error;
    }
}

/**
 * The age in seconds of the oldest import still held, by its last activity (`updated_at`), from the database's own clock.
 * 0 when there is none.
 *
 * @param pool - The recipe database pool.
 * @returns The age in seconds.
 * @sideEffect Reads `recipe_imports`.
 */
export async function oldestImportAgeSeconds(pool: ExpiryQueryable): Promise<number> {
    const result = await pool.query(
        `SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(updated_at))), 0) AS age FROM recipe_imports`,
        [],
    );

    return Number((result.rows[0] as { age: string | number } | undefined)?.age ?? 0);
}

/**
 * Publish the age of the oldest import, THEN run the purge and publish the count it deleted (only when it succeeded). The
 * age goes first so nothing the delete does (fail, wait, run to the host's timeout) can keep it unpublished. A failed purge
 * still fails the tick; a failed age read is logged and swallowed, because observation must never stop the purge.
 *
 * @param deps - The recipe pool, this deploy's stage, and the metric sink.
 * @sideEffect Deletes aged imports (see {@link purgeFinishedImports}), reads `recipe_imports`, and writes EMF lines.
 */
export async function runImportPurge(deps: {
    readonly pool: ImportPurgePool;
    readonly stage: string;
    readonly emit: (metric: EmfMetric) => void;
}): Promise<void> {
    await publishOldestImportAge(deps);

    deps.emit({
        namespace: IMPORT_METRIC_NAMESPACE,
        name: IMPORTS_PURGED_METRIC_NAME,
        unit: 'Count',
        stage: deps.stage,
        value: await purgeFinishedImports(deps.pool),
    });
}

/**
 * Publish the oldest import's age, swallowing a read failure (it is logged).
 *
 * @param deps - The recipe pool, this deploy's stage, and the metric sink.
 * @sideEffect Reads `recipe_imports` and writes one EMF line.
 */
async function publishOldestImportAge(deps: {
    readonly pool: ExpiryQueryable;
    readonly stage: string;
    readonly emit: (metric: EmfMetric) => void;
}): Promise<void> {
    try {
        deps.emit({
            namespace: IMPORT_METRIC_NAMESPACE,
            name: OLDEST_IMPORT_AGE_METRIC_NAME,
            unit: 'Seconds',
            stage: deps.stage,
            value: await oldestImportAgeSeconds(deps.pool),
        });
    } catch (error) {
        logger.warn('bulk import age could not be read this tick', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
