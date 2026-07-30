-- 0017_erasure_election.sql (CR-002 / U3a+U3b) — the erasure DONATE election + the captured removed set.
--
-- Two additive columns on account_erasure_jobs, both for the owner-only-scoped erasure the worker now
-- performs (it no longer deletes ALL owner content — truly-public + donated recipes are KEPT):
--
--   1. publish_recipe_ids — the per-recipe DONATE election (U3b). The recipe ids the owner elected to
--      PUBLISH (donate) instead of remove. This ROW is the source of truth for the election; the SQS
--      message is a derived carrier the sweeper reconstructs FROM this column. NULL ⇒ donate nothing.
--
--   2. removed_recipe_ids — the captured REMOVED-recipe id set (U3a / crash-convergence). Written inside
--      the same transaction that deletes those recipes, so a crash between the row delete and the S3 sweep
--      still converges: the redelivered message re-claims the still-`running` job and reads this column to
--      finish the per-removed-recipe object sweep (after the DELETE the ids are unrecoverable from
--      `recipes`, and the sweep must NOT fall back to the owner-wide prefix — that would delete kept media).
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/account.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. Both columns are NULLABLE with NO default (metadata-only ADD COLUMN, no
-- table rewrite). An in-flight job created before this migration has publish_recipe_ids = NULL, which the
-- worker reads as "donate nothing" (the honest default), and removed_recipe_ids = NULL, which it computes
-- fresh on first claim — so no backfill is required and no existing job changes behaviour.

ALTER TABLE "account_erasure_jobs" ADD COLUMN "publish_recipe_ids" jsonb;
ALTER TABLE "account_erasure_jobs" ADD COLUMN "removed_recipe_ids" jsonb;
