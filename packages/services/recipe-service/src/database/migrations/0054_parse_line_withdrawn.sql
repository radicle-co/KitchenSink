-- 0054 — a parse-job line can be WITHDRAWN: the cook kept it as written, so no engine is to be asked for it.
--
-- ⛔ WHY A STATUS, NOT A FLAG. "Add as written" used to leave the line `pending` (or `failed_retryable`) on the
-- server, so its queued message was still claimed later and the engines — Bedrock included — were paid for an
-- answer the client had already discarded. The worker's claim already requires `status = 'pending'` under the row
-- lock (parseLine.ts `claimLine`), so a status the claim cannot match is the whole mechanism: nothing new for the
-- worker to read, and a withdrawn line is terminal for the job aggregate (it falls to the aggregate's ELSE arm).
--
-- ⚠️ EXPAND-FIRST (ADR-0035): widening a CHECK only admits a value nothing wrote before. An older worker never
-- matches a withdrawn row (its claim needs 'pending'); the one thing it would do is let an in-flight landing
-- overwrite one, which the release that ships this closes on the worker side (`status <> 'withdrawn'`).
--
-- The constraint was created inline by 0039, so Postgres named it `<table>_<column>_check`.
ALTER TABLE recipe_parse_job_lines
    DROP CONSTRAINT IF EXISTS recipe_parse_job_lines_status_check;

ALTER TABLE recipe_parse_job_lines
    ADD CONSTRAINT recipe_parse_job_lines_status_check
    CHECK (status IN ('pending', 'parsed', 'unparseable', 'failed_retryable', 'withdrawn'));
