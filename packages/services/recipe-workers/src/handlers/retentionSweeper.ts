/**
 * Analytics plan U6 — the scheduled analytics retention sweeper (origin R10, R9's v1 arm; AE5).
 *
 * Deletes raw `analytics_events` rows older than {@link RETENTION_MONTHS} months, daily. The cutoff
 * keys **`created_at`** — the server clock — never `occurred_at`, which is client-asserted on
 * ingest-door rows and could be set arbitrarily far in the past to age a row straight into deletion
 * (0043's header states the rule; this is its enforcement point).
 *
 * ## Why fold-before-delete needs NO runtime check here (KTD1)
 *
 * Counts fold into `recipe_impact_signals` by the statement-level AFTER INSERT trigger at landing
 * time, so every row old enough for this sweep was folded months before it — there is no "unfolded
 * row" state to check for. And because 0043 ships NO DELETE trigger (absence pinned by the recipe
 * service's integration suite), this DELETE provably moves no counts: AE5's invariant — a recipe's
 * lifetime save count identical before and after a retention pass — holds by construction, and the
 * integration tier asserts it against a real database anyway (the mutation lens: a recompute fold or
 * a helpful DELETE trigger added later fails that suite, not production).
 *
 * ## Batched and bounded, per tick
 *
 * The delete is an id-scoped subquery with `LIMIT {@link RETENTION_DELETE_BATCH}`, looped until a
 * short batch or {@link RETENTION_MAX_BATCHES_PER_TICK} — one tick never holds a long lock over an
 * unbounded delete, and a backlog (a first deploy over months of rows) drains across ticks. The
 * `analytics_events_created_idx` index (0043) makes each batch's selection cheap.
 *
 * ## The S3 door stays open (origin R9)
 *
 * Deletion is the v1 arm of retention. The store's shape (append-only, `created_at`-keyed, no
 * in-place mutation but the erasure UPDATE) is precisely what an S3/Athena export tier consumes; when
 * volume ever justifies archival, an export step lands BEFORE this delete in this same handler —
 * nothing here needs redesign.
 *
 * VPC-attached DB consumer (ADR-0004's NAT ledger carries `AnalyticsRetentionSweeperFunction`; the
 * marker-block set-equality test reads the ADR). Runs seconds per day against the in-VPC database, so
 * actual NAT traffic is ~zero.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { getRecipeDb } from '../common/db.js';
import { logger } from '../common/logger.js';
import { emitMetric } from '../common/metrics.js';

/** The retention rule (origin R10, owner ruling 2026-09-01): raw event rows live 6 months. */
export const RETENTION_MONTHS = 6;

/** Rows per DELETE batch — small enough that no single statement holds a long lock. */
export const RETENTION_DELETE_BATCH = 5_000;

/** Batches per tick — bounds the Lambda's runtime; a backlog drains across daily ticks. */
export const RETENTION_MAX_BATCHES_PER_TICK = 20;

/** The analytics namespace (distinct from erasure — retention is hygiene, not compliance). */
const RETENTION_METRIC_NAMESPACE = 'Commise/RecipeAnalytics';

/** The metric the retention dashboard reads: rows aged out this tick (0 on a quiet day). */
export const RETENTION_METRIC_NAME = 'AnalyticsEventsExpired';

/**
 * Delete aged-out analytics rows in bounded batches.
 *
 * @param db - The recipe database handle.
 * @returns How many rows this tick deleted.
 * @sideEffect Deletes `analytics_events` rows older than the retention cutoff.
 */
export async function sweepExpiredEvents(db: NodePgDatabase<Record<string, never>>): Promise<number> {
    let deleted = 0;

    for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_TICK; batch += 1) {
        const result = await db.execute<{ id: number }>(sql`
            DELETE FROM analytics_events
             WHERE id IN (
                SELECT id FROM analytics_events
                 WHERE created_at < now() - ${`${RETENTION_MONTHS} months`}::interval
                 LIMIT ${RETENTION_DELETE_BATCH}
             )
             RETURNING id
        `);

        deleted += result.rows.length;

        if (result.rows.length < RETENTION_DELETE_BATCH) {
            break;
        }
    }

    return deleted;
}

/**
 * The scheduled entry point: sweep, then report.
 *
 * @sideEffect Deletes aged analytics rows; emits one EMF metric line; logs the tick's count.
 */
export const handler = async (): Promise<void> => {
    const db = getRecipeDb();
    const deleted = await sweepExpiredEvents(db);

    emitMetric({
        namespace: RETENTION_METRIC_NAMESPACE,
        name: RETENTION_METRIC_NAME,
        unit: 'Count',
        stage: process.env['STAGE'] ?? 'unknown',
        value: deleted,
    });
    logger.info('analytics retention sweep complete', { deleted });
};
