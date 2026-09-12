-- The generation a landed line was produced by (plan item D).
--
-- ⛔ WHY THE COLUMN EXISTS: `recipe_parse_job_lines` records no engine version, so copy-forward can only
-- ask HOW OLD an answer is, never WHICH ENGINES produced it. A model pin changed inside the recency
-- window therefore still serves the previous generation's answer. The window is a PROXY for this fact;
-- recording the fact is what lets it be deleted rather than tuned.
--
-- ⚠️ EXPAND-FIRST, and the reader is deliberately a LATER release (ADR-0035's standing precondition).
-- This migration and the worker that writes the column ship together; the copy-forward predicate starts
-- reading it only once every candidate row can carry one. A NULL means "landed before this shipped" and
-- is refused by the future reader — `expireParseJobs` deletes a job seven days past its 24-hour expiry,
-- so no candidate outlives ~8 days and no backfill is owed.
--
-- ⚠️ NO INDEX. The copy-forward lookup is already served by `recipe_parse_job_lines_copy_forward_idx`,
-- and this column is an equality filter applied to rows that index has already narrowed to one digest.
-- An index here would serve zero reads while adding write amplification on every landing.
ALTER TABLE recipe_parse_job_lines
    ADD COLUMN IF NOT EXISTS engine_generation text;
