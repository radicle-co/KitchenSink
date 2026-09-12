-- 0010: add `source_call_log.channel` ('interactive' | 'worker') — the lane dimension that turns FR-019's
-- reserved user-facing headroom from an ADVISORY convention into an ENFORCED admission cap
-- (ingredient-search plan §2 Stage 3, resolution F-W1; fix-ingredient-resolution-quality plan U29).
--
-- Hand-authored, ordered DDL applied once by the in-VPC migration runner (see
-- src/lambdas/migrate/handler.ts). The runner wraps this file in a single BEGIN/COMMIT, so it must NOT
-- open its own transaction. The Drizzle definition in src/db/schema/operational.ts documents the same
-- post-migration shape (`sourceCallChannelEnum` + `source_call_log.channel`).
--
-- ── WHY A COLUMN AND NOT A CONFIG KNOB (F-W1: "a real migration, not config") ──────────────────────
--   FR-019 already reserves the top 10% of each source's window (USDA: 100 calls/hr) "as headroom for
--   user-facing re-fetches". Until now that reserve existed ONLY because the worker voluntarily consulted
--   `RollingWindowLimiter.isPaused` before draining: `tryRecord` charged EVERY caller against the same
--   `hardCap`, and the ledger had no way to say which caller spent what. Two consequences, both real:
--     (1) NOT ENFORCED — `isPaused` is consulted once per drain decision, but a single fan-out then issues
--         a `searchByName` plus up to twenty `fetchByKeys`. A drain that passed the check at 899 could
--         push the window to 919 and eat the reserve a waiting cook's search depends on.
--     (2) NOT OBSERVABLE — with only `(source, called_at)` there is no query that answers "did the drain
--         eat the reserve last hour?", so the failure above is invisible in production. The interactive
--         lane is exactly the kind of guarantee that is worthless if it cannot be checked.
--   The column fixes both: the limiter admits the worker only while the WINDOW is under the 90% threshold
--   and the interactive lane up to the hard cap, and every row now records which lane spent it.
--
-- ── THE TWO LANES ARE NOT TWO BUDGETS ─────────────────────────────────────────────────────────────
--   USDA rate-limits our egress IP, so both lanes spend the SAME 1,000/hr key. The admission COUNT stays
--   aggregate (every lane's rows) and only the CAP differs per lane. A `WHERE channel = $channel` in the
--   count would hand each lane its own full cap and let the two together reach 2x USDA's real limit —
--   an SC-002 breach that reads as perfectly correct in isolation. `tests/sourceCallLog.dao.integration.test.ts`
--   asserts the cross-lane predicate directly for exactly this reason.
--
-- ── BACKFILL: 'worker', DELIBERATELY THE CONSERVATIVE DIRECTION ───────────────────────────────────
--   `NOT NULL DEFAULT 'worker'` backfills every pre-existing row to the tighter lane. Both plausible
--   defaults are wrong about SOME historical rows (the FR-RES-2 resolve re-fetch was user-facing and
--   charged the same undifferentiated ledger), so the choice is which way to be wrong: 'worker' makes the
--   interactive lane look emptier than it was and the drain's ceiling arrive sooner, which errs toward
--   PROTECTING the reserve. 'interactive' would have erred toward letting the drain overshoot it.
--   PostgreSQL 11+ stores an ADD COLUMN default in the catalog, so this is metadata-only — no table
--   rewrite, no long lock, on a table that is a rolling ledger and self-prunes to the trailing hour anyway.
--
-- ── EXPAND-FIRST, AND SAFE ON A ROLLING DEPLOY ────────────────────────────────────────────────────
--   The old code inserts `(source, called_at)` and never names `channel`; the DEFAULT makes those inserts
--   keep succeeding, so a task running the previous image during the ECS stabilisation window still
--   records its calls (as 'worker' — the conservative lane again) rather than erroring and making an
--   UNRECORDED source call, which is the one failure mode that would actually breach the cap (ADR-0022).
--
-- ── THE INDEX IS REPLACED, NOT SUPPLEMENTED ───────────────────────────────────────────────────────
--   Every admission query still filters `(source, called_at)` and NEVER `channel` (see "not two budgets"),
--   so `channel` goes LAST in the composite: it leaves the existing two-column prefix intact for the hot
--   path while letting the per-lane observability count (`countInWindow(source, channel)`) and the admin
--   metrics read be served from the same index instead of a second one. A separate index would double the
--   write amplification on the hottest-written table in the schema for a read nothing does per request.
--
-- @implements FR-019 FR-020

CREATE TYPE "source_call_channel" AS ENUM ('interactive', 'worker');

ALTER TABLE "source_call_log"
    ADD COLUMN "channel" "source_call_channel" NOT NULL DEFAULT 'worker';

DROP INDEX IF EXISTS "idx_source_call_log_source_called_at";

CREATE INDEX "idx_source_call_log_source_called_at" ON "source_call_log" ("source", "called_at", "channel");

COMMENT ON COLUMN "source_call_log"."channel" IS
    'Which lane spent this call: ''interactive'' (a waiting human — live search, PATCH-resolve re-fetch) or ''worker'' (background fan-out / change-refresh). Both lanes spend ONE shared per-source quota; the lane decides only how far into that quota the caller may push the window. See migration 0010.';
