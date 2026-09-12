-- 0019 — one block per source, shared by every task (ADR-0053 §5, curated catalog plan U27).
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/operational.ts documents the same shape (`sourceBackoff`).
--
-- ── Why a table ──────────────────────────────────────────────────────────────────────────────────
--   A 429, a 502/503/504 or a low publisher quota blocks the source. The block used to live in one process's
--   memory for 60 s, so the API, the worker and change-refresh each walked into the same refusal. One row per
--   source makes the block a fact every task reads at admission, under the limiter's advisory lock.
--
-- ── Why one row per source ───────────────────────────────────────────────────────────────────────
--   Only the latest end matters. The ledger's upsert keeps the later `blocked_until`, so a short block never
--   shortens a long one. An expired row is harmless: admission reads `blocked_until > now()`.
--
-- ── `reason` is text + CHECK, not an enum ────────────────────────────────────────────────────────
--   The set is the transport's `BLOCK_REASONS` (`sources/transport/blockRule.ts`), and a guard holds the two
--   equal. It is operational mechanics that may grow with a new block rule, which is the DB-7 case for a CHECK.
--
-- Additive only (ADR-0035): nothing reads this table until the release that ships the transport.

CREATE TABLE IF NOT EXISTS "source_backoff" (
    "source" food_source PRIMARY KEY,
    "blocked_until" timestamptz NOT NULL,
    "reason" text NOT NULL,
    "observed_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "source_backoff_reason_known"
        CHECK ("reason" IN ('rateLimited', 'quotaExhausted', 'quotaLow', 'unavailable')),
    CONSTRAINT "source_backoff_ends_after_observed" CHECK ("blocked_until" > "observed_at")
);

-- 0010 described the lane as deciding how far into the quota a caller may push. ADR-0053 §2 gave every caller one 90%
-- ceiling, and the owner's 2026-10-02 rulings gave the worker's own calls a share of it, so admission reads this
-- column for that one count.
COMMENT ON COLUMN "source_call_log"."channel" IS
    'Which lane spent this call: ''interactive'' (a waiting human: live search, PATCH-resolve re-fetch) or ''worker'' (background fan-out, change-refresh). Admission counts every lane''s calls together against the per-source ceiling, 90% of the declared limit (ADR-0053 §2), and counts the worker''s own calls against WORKER_WINDOW_SHARE of that ceiling (sourceCeiling.ts). Live calls never count toward the worker''s share.';
