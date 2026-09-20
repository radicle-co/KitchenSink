-- 0048 — copy-forward dedup BEFORE queuing (plan 2026-09-19-001).
--
-- ⛔ WHY. `ParseJobsService.create` enqueues one SQS message per pasted line unconditionally. The parse
-- cache IS consulted, but inside the worker — after the send, the receive and the claim have all been paid
-- for. Measured on `kitchensink-recipe-parse-pr-91` for September: `NumberOfMessagesSent` = 1,650,952 for a
-- 2,502-line corpus, of which only 277,586 (16.8%) were ever received. That is a PRODUCER count, not
-- redelivery — the same lines re-enqueued over and over, every one of them already answered.
--
-- The cure is to copy a prior answer forward at `create`: a line this owner has already had answered is
-- inserted WITH that answer and sends no message. The identity is the EXISTING `line_digest` — there is no
-- second identity for a line.
--
-- ⛔ WHY A COLUMN IS NEEDED AT ALL, AND IT IS NOT BOOKKEEPING. Without it, copy-forward launders its own
-- generations. `landed_at` is read from `updated_at`, and a COPIED row's `updated_at` is its INSERT time,
-- not the original landing — so an answer landed at T0, copied at T1, then copied again from that copy at
-- T2 presents as having landed at T1. The answer would never age out, and BOTH the recency window and the
-- corrections watermark would be defeated by a chain of copies. The candidate predicate therefore requires
-- `copied_at IS NULL`: only a line the WORKER landed may be a source.
--
-- ⚠️ It has a second job, which is why the COMMENT names both: it is the only way this feature's hit rate
-- can ever be observed, and the only way to answer "why did my line come back already parsed?".
--
-- ⛔ NOT `CONCURRENTLY`. `@kitchensink/db-schema-guard`'s `applyMigrations` wraps EACH file in BEGIN/COMMIT,
-- and `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. At this table's size a plain build is a
-- brief lock; at a size where it is not, the index is created out of band and this file made a no-op.
--
-- EXPAND-FIRST (ADR-0035): one NULLABLE column with no backfill and no constraint, plus an additive index.
-- Rows written by the release before this one carry NULL, which reads correctly as "landed, not copied" —
-- the value the predicate wants for every pre-existing row. The previous release keeps working against the
-- migrated schema and this one keeps working against rows it did not write.

ALTER TABLE recipe_parse_job_lines
    ADD COLUMN copied_at timestamptz;

COMMENT ON COLUMN recipe_parse_job_lines.copied_at IS
    'When this line''s answer was COPIED from a previously landed line rather than landed by the worker. '
    'NULL means the worker landed it. Two jobs: it is the anti-laundering predicate that keeps a copy from '
    'becoming a copy source (which would defeat the recency window and the corrections watermark), and it '
    'is the only observable measure of copy-forward''s hit rate.';

-- Serves the candidate lookup: find this line's previously landed answers, newest first.
--
-- ⛔ PARTIAL, and the predicate mirrors the query's own exactly — only a worker-landed line carrying a
-- proposal can ever be a candidate, so every other row is dead weight in the index. `updated_at DESC` is
-- included because the lookup takes the NEWEST answer per digest (`DISTINCT ON`), so the index can serve
-- the ordering rather than making the planner sort.
--
-- ⚠️ `owner_id` is deliberately NOT here: it lives on `recipe_parse_jobs`, and denormalising it onto the
-- line row would create a second representation of a fact the join already owns.
CREATE INDEX recipe_parse_job_lines_copy_forward_idx
    ON recipe_parse_job_lines (line_digest, updated_at DESC)
    WHERE proposal IS NOT NULL AND copied_at IS NULL;
