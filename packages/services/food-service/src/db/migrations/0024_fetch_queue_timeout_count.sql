-- 0024 — a per-row count of source CLIENT TIMEOUTS, so a food that times out on every pass stops being deferred.
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/operational.ts documents the same shape (`fetchQueue.timeoutCount`).
--
-- ── Why a column ────────────────────────────────────────────────────────────────────────────────
--   A client timeout (`statusCode 0`) defers ONE food for 30 s and spends no `attempts`: it is self-inflicted latency,
--   not a defect of the food. With nothing counted, a food whose lookups always time out was deferred for ever — not
--   in the failure budget, not past a lease deadline, so not in anything the queue watcher reads. `timeout_count` is
--   that count. The worker adds one on each timeout and fails the row (the existing `FAILED` tombstone, which the
--   watcher reports as dead-lettered) once it reaches `MAX_TIMEOUT_DEFERRALS`.
--
-- ── Reset ───────────────────────────────────────────────────────────────────────────────────────
--   Reactivating a tombstoned row (`enqueue.emitter`, which the requeue and refetch routes and the recovery service
--   all go through) resets it beside `attempts`.
--
-- Additive only, expand-first (ADR-0035): the column defaults to 0, so the release before the one that counts reads
-- and writes the table unchanged.

ALTER TABLE "fetch_queue" ADD COLUMN IF NOT EXISTS "timeout_count" integer NOT NULL DEFAULT 0;
