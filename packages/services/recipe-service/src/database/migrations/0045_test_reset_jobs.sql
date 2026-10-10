-- 0045 — the test-principal RESET job (ADR-0040).
--
-- `POST /api/v1/account/test-reset` records one row and hands the purge to the account-erasure worker, exactly
-- as `account_erasure_jobs` (0005) does for GDPR erasure: the row is the durable source of truth, the SQS message
-- is a derived latency optimization, and the worker claims the row before any destructive work.
--
-- ⛔ WHY NOT A ROW IN `account_erasure_jobs`. Erasure is ONE-SHOT: a completed job answers every later request
-- with `410 ALREADY_ERASED`, keeps truly-public recipes pseudonymized, and deletes the Clerk user. A test-pool slot
-- must be reset before AND after every run, forever, with nothing kept. Sharing the table would put the `410`
-- rule and the "repeatable, total" rule on the same `status` column, and one of them would have to lose.
--
-- ⛔ AT MOST ONE ACTIVE JOB PER USER — the partial unique index below, and the DAL's `ON CONFLICT` target repeats
-- its predicate. A concurrent second request gets the running job back (`202`) instead of racing a second purge.
-- A `completed` row is outside the predicate, so the next reset inserts cleanly.
--
-- `status` mirrors erasure's four values. The worker never writes `failed` (an attempt that throws records
-- `last_error` and stays `running` for SQS to redeliver — see `recordErasureJobError`); `failed` exists for
-- whatever drains the DLQ, as it does for erasure.

CREATE TABLE test_reset_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar(255) NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_test_reset_jobs_active_user
    ON test_reset_jobs (user_id)
    WHERE status IN ('queued', 'running');

COMMENT ON TABLE test_reset_jobs IS
    'ADR-0040: one repeatable self-purge per test principal; at most one active job per user.';
