/**
 * THE PARSE JOB'S AGGREGATE RULE (plan U8/U9) — one SQL statement, one representation, two deployables.
 *
 * `recipe_parse_jobs.status` is DERIVED from the job's lines: still `running` while any line is pending,
 * `partial` when none are pending but some are retryable, `complete` when every line is terminal. TWO
 * writers apply that rule — the worker (`recipe-workers/handlers/parseLine.ts`, after every landing) and
 * the producer (`recipe-service`'s `ParseJobsDal`, after marking lines `failed_retryable` on an enqueue
 * failure) — and two hand-written copies of a CASE expression are exactly the drift `bandAuthorityStore.ts`
 * exists to prevent one directory over. Same remedy: the SQL lives HERE, in the zod-only shared leaf both
 * sides already import, as text over one `$1` (the job id).
 *
 * ⛔ The `WHERE job.status IN ('running', 'partial')` guard is part of the rule: an `expired` job is
 * TERMINAL (the TTL sweep closed it) and a landing that arrives afterwards must never resurrect it — the
 * line's own landing may still record, but the job's verdict stands.
 *
 * ⚠️ Deliberately NOT applied by retry/edit: those flip lines back to `pending` and set the job `running`
 * explicitly, because the CASE's first arm KEEPS the current status while lines are pending — correct for
 * a landing, wrong for a re-drive of a `partial` job.
 */

/** Recompute one job's derived status from its lines. `$1` = job id. See the module docstring. */
export const PARSE_JOB_AGGREGATE_SQL = `UPDATE recipe_parse_jobs job
    SET status = CASE
            WHEN EXISTS (SELECT 1 FROM recipe_parse_job_lines l
                          WHERE l.job_id = job.id AND l.status = 'pending') THEN job.status
            WHEN EXISTS (SELECT 1 FROM recipe_parse_job_lines l
                          WHERE l.job_id = job.id AND l.status = 'failed_retryable') THEN 'partial'
            ELSE 'complete'
        END,
        updated_at = now()
  WHERE job.id = $1 AND job.status IN ('running', 'partial')`;
