/**
 * THE PARSE-JOB TTL SWEEP (plan U9, origin D9/R13) — expiry, then purge, on the band drain's 15-minute tick.
 *
 * ⛔ Two distinct bounds, on purpose:
 *
 *  1. **Expiry** (`expires_at`, set by the producer from `PARSE_JOB_TTL_HOURS`): every job past its
 *     deadline flips to `expired` — REGARDLESS of status, because the TTL is the job's LIFETIME, not a
 *     stall detector. A completed job holds the cook's pasted text just as an abandoned one does, and
 *     the 202 response carries `expiresAt` so the client knows the review deadline. `expired` is
 *     terminal: mutations refuse it (the DAL also derives expiry from the timestamp, so nothing sneaks
 *     into this sweep's lag window), and an abandoned job mints zero catalog entities because proposals
 *     bind nothing (R19).
 *  2. **Purge** ({@link PARSE_JOB_PURGE_AFTER_DAYS} past expiry): the rows are DELETED outright,
 *     cascading to the lines — the pasted text is user content, and "expired but retained forever" would
 *     be a retention bound in name only. The window between the two exists so a cook who returns shortly
 *     after expiry sees an honest `expired` job rather than a 404.
 *
 * ⚠️ Hosted on the band drain's schedule rather than a Lambda of its own: a new function would be a new
 * NAT consumer (ADR-0004's guard-tested list) and a new migration-barrier entry for two UPDATE
 * statements. The drain already ticks every 15 minutes against this database; the sweep costs one indexed
 * read (`recipe_parse_jobs_expiry_idx`) per tick when there is nothing to do. Unlike the drain's sends it
 * spends nothing, so it runs OUTSIDE the drain's headroom budget.
 */

/** How long an `expired` job's rows are kept before the purge deletes them (a grace for honest 409s/UI). */
export const PARSE_JOB_PURGE_AFTER_DAYS = 7;

/** The minimal query surface the sweep needs — `pg.Pool` satisfies it structurally. */
export interface ExpiryQueryable {
    query(text: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * How long the OLDEST still-running parse job has been running, in seconds — `0` when none is.
 *
 * ## What this measures, and why nothing measured it before
 *
 * A job goes terminal when its last line lands (`PARSE_JOB_AGGREGATE_SQL`). A line that never lands — the
 * landing discarded, the message refused, the engine silent — leaves the job `running` until the TTL sweep
 * above flips it to `expired` a day later. From the cook's side that is an import that simply never
 * completes: no error, no failed state, nothing to click. Nothing in this system could say it was
 * happening, because the STALL has no event — it is the absence of one.
 *
 * ⛔ `running` ONLY. The status CHECK admits `running | partial | complete | expired`; `complete` and
 * `expired` are terminal, and `partial` is the aggregate a job reaches when a line is `failed_retryable` —
 * the resting state `POST :id/retry` exists for, where the system is waiting on a HUMAN rather than failing
 * to answer. Folding `partial` in would make the detector fire on the product working as designed.
 *
 * ⛔ `COALESCE(…, 0)`, and it is not defensive tidying. `MAX` over no rows is `NULL`; a `NULL` handed to
 * `emitMetric` publishes an EMF line CloudWatch discards, so the alarm would see NO datapoints on an idle
 * stage — indistinguishable from an emitter that is gone. Emitting a real `0` every tick is what makes the
 * series continuous, which is the property that lets the alarm below treat missing data as a fault.
 *
 * @param pool - The recipe database pool.
 * @returns Seconds since the oldest running job was created, or 0. Impure.
 * @sideEffect Reads `recipe_parse_jobs`.
 */
export async function oldestRunningParseJobAgeSeconds(pool: ExpiryQueryable): Promise<number> {
    const result = await pool.query(
        `SELECT COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at))), 0) AS age
           FROM recipe_parse_jobs
          WHERE status = 'running'`,
        [],
    );

    return Number((result.rows[0] as { age: string | number } | undefined)?.age ?? 0);
}

/**
 * Flip overdue jobs to `expired`, then purge jobs past the retention horizon.
 *
 * Expire-then-purge in that order so a job crossing BOTH bounds in one tick (first tick after a long
 * outage) is simply deleted — the intermediate flip is not observable and not owed to anyone.
 *
 * @param pool - The recipe database pool.
 * @sideEffect Updates and deletes parse-job rows (deletes cascade to their lines).
 */
export async function expireParseJobs(pool: ExpiryQueryable): Promise<void> {
    await pool.query(
        `UPDATE recipe_parse_jobs
            SET status = 'expired', updated_at = now()
          WHERE expires_at <= now() AND status <> 'expired'`,
        [],
    );
    await pool.query(
        `DELETE FROM recipe_parse_jobs
          WHERE expires_at <= now() - ($1 || ' days')::interval`,
        [String(PARSE_JOB_PURGE_AFTER_DAYS)],
    );
}
