-- 0046 — parse-line CLAIM bookkeeping (plan U6, R6/R7/R9/R12/R18).
--
-- ⛔ WHY. `parseLine.ts` runs the pipeline FIRST and decides what to land afterwards, so every delivery of a
-- message pays for its engines before anything can observe that the work was pointless. Three populations
-- pay that cost for nothing today:
--
--   * a line whose JOB has expired — the sweep will discard whatever lands, so the CRF invoke and the gated
--     Bedrock call bought an answer nobody will read;
--   * a line that has ALREADY been parsed — a duplicate delivery re-runs the whole pipeline to produce a
--     landing the digest guard then discards;
--   * two deliveries of the SAME line arriving together — SQS standard delivery is at-least-once, so this is
--     ordinary, and both currently call the engines.
--
-- The cure is a CLAIM: one statement, ahead of any paid work, that asserts the job is unexpired, the stored
-- digest matches and the line is still claimable, and records the attempt. Zero rows returned IS the refusal,
-- and the message completes having invoked nothing.
--
-- ⛔ `last_received_at` IS THE LEASE, which is why there is no new status value. A claim requires the column
-- to be NULL or older than the handler's own timeout — so a duplicate delivered WHILE the first attempt is
-- running is refused, while a genuine redelivery (which SQS only makes after the queue's visibility timeout,
-- deliberately set ABOVE that handler timeout) is admitted. Moving the row to a `claimed` status would have
-- done the same job and cost a CHECK-constraint change, an aggregate-SQL change and a wire-visible status the
-- API would have had to explain.
--
-- ⛔ `attempts` COUNTS CLAIMED DELIVERIES, not failures and not receives — a receive is spent even when the
-- consumer cannot reach this database, a claim is not — and that is the point: a line that keeps being redelivered
-- without landing is invisible today — it simply stays `pending` until its job's TTL sweeps the whole import,
-- with no signal and nothing the cook can do. Past the allowance the handler makes it `failed_retryable` with
-- `failure_code` set, which is exactly the population `POST /api/v1/parse-jobs/:id/retry` re-drives.
--
-- EXPAND-FIRST (ADR-0035): three NULLABLE columns with no backfill and no constraint. Rows written by the
-- release before this one read `attempts = 0` through COALESCE, so the previous release keeps working against
-- the migrated schema and this one keeps working against rows it did not write.

ALTER TABLE recipe_parse_job_lines
    ADD COLUMN attempts integer,
    ADD COLUMN last_received_at timestamptz,
    ADD COLUMN failure_code text;

COMMENT ON COLUMN recipe_parse_job_lines.attempts IS
    'U6: deliveries claimed for this line. NULL means pre-migration; readers COALESCE to 0.';
COMMENT ON COLUMN recipe_parse_job_lines.last_received_at IS
    'U6: when the last delivery claimed this line — the claim lease, so a concurrent duplicate is refused.';
COMMENT ON COLUMN recipe_parse_job_lines.failure_code IS
    'U6: why a line became failed_retryable, so the retry endpoint can tell the cook what went wrong.';
