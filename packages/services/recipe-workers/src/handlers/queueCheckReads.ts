/**
 * WHAT "OWED" MEANS FOR EACH OF RECIPE'S WORK CLASSES (plan U12, R29/R30/R32/R34/R36) — one SQL statement
 * per class, and the transport each one is carried by.
 *
 * ⛔ THE FIVE STATEMENTS LIVE HERE RATHER THAN IN `queueCheck.ts` because they answer a different question.
 * `queueCheck.ts` holds the RULE — read everything, classify, escalate, check in — which is the part a
 * reviewer has to reason about and which is identical in all three services. This file holds what each of
 * recipe's tables happens to call its owed rows, which is the part that changes whenever a migration lands.
 *
 * ⛔ EVERY STATEMENT RETURNS THE SAME FIVE COUNTS, deliberately, because `classifyOwed` decides severity from
 * their relationship and not from which table they came out of. A class that could not fill one of them says
 * so with a literal `0` and a comment, rather than filling it with something approximate — an approximate
 * `never_received` is read as "nobody is coming", which is the escalation an operator drops everything for.
 */

/** A class the backstop covers, and where its transport depth is read from. */
export interface RecipeWorkClass {
    /** The closed-vocabulary name this class reports under. Never user input. */
    readonly queueName: string;
    /** One statement returning exactly the five counts, parameterised by {@link RecipeWorkClass.params}. */
    readonly sql: string;
    /**
     * The env names whose positive-integer values bind `$1`, `$2`, … in order.
     *
     * ⛔ PER CLASS, never one shared lease. Parse and verification are configured with different leases and
     * different allowances by the stack that owns each function; measuring both against one number reports
     * rows as stuck that their consumer is about to finish, or misses rows it gave up on an hour ago — and
     * both readings look equally authoritative to whoever is paged.
     */
    readonly params: readonly string[];
    /** Env name holding the queue URL, or `undefined` when this class has no transport. */
    readonly queueUrlEnv: string | undefined;
    /** Env name holding the dead-letter queue URL, or `undefined` when there is none. */
    readonly dlqUrlEnv: string | undefined;
}

/** Every class the recipe backstop covers. */
export const RECIPE_WORK_CLASSES: readonly RecipeWorkClass[] = [
    {
        queueName: 'parse-lines',
        // ⛔ Joined to the JOB, because an expired job's pending lines are NOT owed — the sweep discards
        // whatever would land, so counting them would escalate work the system has correctly abandoned.
        sql: `
            SELECT
                count(*) FILTER (WHERE l.status = 'pending')::int AS owed_past_deadline,
                count(*) FILTER (WHERE l.status = 'pending' AND l.last_received_at IS NULL)::int
                    AS never_received,
                count(*) FILTER (WHERE l.status = 'failed_retryable' AND l.failure_code IS NOT NULL)::int
                    AS at_allowance,
                count(*) FILTER (
                    WHERE l.status = 'pending' AND l.last_received_at < now() - ($1 || ' seconds')::interval
                )::int AS claimed_too_long,
                COALESCE(
                    MAX(EXTRACT(EPOCH FROM (now() - j.created_at))) FILTER (WHERE l.status = 'pending'),
                    0
                )::int AS oldest_owed_seconds
            FROM recipe_parse_job_lines l
            JOIN recipe_parse_jobs j ON j.id = l.job_id
            WHERE j.expires_at > now()
        `,
        params: ['PARSE_CLAIM_LEASE_SECONDS'],
        queueUrlEnv: 'RECIPE_PARSE_QUEUE_URL',
        dlqUrlEnv: 'RECIPE_PARSE_DLQ_URL',
    },
    {
        queueName: 'verifications',
        // ⚠️ A row EXISTS here only while a verification is owed: the settle deletes it in the same statement
        // that writes the verdict (migration 0047). So every row is owed by construction, and there is no
        // status to filter on — which is also why `never_received` is 0 rather than a guess: the row is
        // created BY the first claim, so a verification nothing has claimed has no row to be counted.
        sql: `
            SELECT
                count(*)::int AS owed_past_deadline,
                0 AS never_received,
                count(*) FILTER (WHERE attempts >= $2)::int AS at_allowance,
                count(*) FILTER (WHERE last_received_at < now() - ($1 || ' seconds')::interval)::int
                    AS claimed_too_long,
                COALESCE(MAX(EXTRACT(EPOCH FROM (now() - last_received_at))), 0)::int AS oldest_owed_seconds
            FROM recipe_verification_attempts
        `,
        params: ['VERIFICATION_CLAIM_LEASE_SECONDS', 'VERIFICATION_ATTEMPT_ALLOWANCE'],
        queueUrlEnv: 'INGREDIENT_VERIFICATION_QUEUE_URL',
        dlqUrlEnv: 'INGREDIENT_VERIFICATION_DLQ_URL',
    },
    {
        queueName: 'archives',
        // The transactional outbox (ADR-0034). A row here is a version whose archive has not been confirmed;
        // the sweeper sends it and the worker deletes it, so an old row means one of those two stopped.
        sql: `
            SELECT
                count(*)::int AS owed_past_deadline,
                count(*)::int AS never_received,
                0 AS at_allowance,
                0 AS claimed_too_long,
                COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at))), 0)::int AS oldest_owed_seconds
            FROM recipe_version_pending_archives
        `,
        params: [],
        queueUrlEnv: 'RECIPE_ARCHIVE_QUEUE_URL',
        dlqUrlEnv: 'RECIPE_ARCHIVE_DLQ_URL',
    },
    {
        queueName: 'handle-sync',
        // ⛔ NO OWED ROWS, AND THAT IS THE POINT. `author_handles` is a PROJECTION — a row is the handle as
        // last applied, not a promise to apply one — so the recipe side has nothing to count as owed. What it
        // can still see is the transport, and a message on the handle-sync DLQ is a display name that will
        // stay wrong on every recipe this author has published until somebody looks. `classifyOwed` reports a
        // dead-lettered message regardless of the owed counts, which is exactly what makes this class worth
        // covering with five zeros. (Identity's check owns the OWED half; see its `queueCheck.ts`.)
        sql: `SELECT 0 AS owed_past_deadline, 0 AS never_received, 0 AS at_allowance,
                     0 AS claimed_too_long, 0 AS oldest_owed_seconds`,
        params: [],
        queueUrlEnv: 'RECIPE_HANDLE_SYNC_QUEUE_URL',
        dlqUrlEnv: 'RECIPE_HANDLE_SYNC_DLQ_URL',
    },
    {
        queueName: 'test-resets',
        // ⚠️ NO TRANSPORT, stated rather than left as three zeros a reader would take for "the queue is
        // empty". ADR-0040's self-purge is run in-process by recipe-service, so a `queued` job that nothing
        // has picked up genuinely IS lost — there is no message in flight that could still arrive — and a
        // `running` job older than the threshold is a request that died mid-purge, leaving a test
        // principal's data half-deleted.
        //
        // ⚠️ `TEST_RESET_STALE_SECONDS` is named a THRESHOLD, not a lease, because it is not one: the
        // runner lives in recipe-service and holds no lease this side can read, so unlike every other
        // class here the number is the backstop's own judgement rather than the consumer's configuration.
        // Residual risk, recorded: a runner that legitimately takes longer would be reported as stuck.
        sql: `
            SELECT
                count(*) FILTER (WHERE status IN ('queued', 'running'))::int AS owed_past_deadline,
                count(*) FILTER (WHERE status = 'queued')::int AS never_received,
                -- ZERO, though a failed row exists and looks like the obvious thing to count. A failed
                -- reset is TERMINAL and already reported to its own caller by GET /account/test-reset;
                -- counting it would raise an exhausted escalation that never clears, because nothing
                -- ever deletes the row -- the permanently-lit signal a reader learns to ignore.
                0 AS at_allowance,
                count(*) FILTER (
                    WHERE status = 'running' AND updated_at < now() - ($1 || ' seconds')::interval
                )::int AS claimed_too_long,
                COALESCE(
                    MAX(EXTRACT(EPOCH FROM (now() - created_at)))
                        FILTER (WHERE status IN ('queued', 'running')),
                    0
                )::int AS oldest_owed_seconds
            FROM test_reset_jobs
        `,
        params: ['TEST_RESET_STALE_SECONDS'],
        queueUrlEnv: undefined,
        dlqUrlEnv: undefined,
    },
];
