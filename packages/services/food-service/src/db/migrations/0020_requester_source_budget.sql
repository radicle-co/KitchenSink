-- 0020 — each requester's hourly share of the source window, shared by every API task (plan 002, the cap owed before
-- S6).
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/operational.ts documents the same shape (`requesterSourceBudget`).
--
-- ── Why a table ──────────────────────────────────────────────────────────────────────────────────
--   Live search and PATCH resolve call the source on a cook's behalf, and every cook and the worker share one window
--   per source (ADR-0053 §2). The per-minute caps live in each task's memory, so one account could still spend the
--   window. A row per requester makes its hourly spend a fact every task charges against.
--
-- ── Why one row per requester, and a fixed window ────────────────────────────────────────────────
--   `RequesterSourceBudgetDao.charge` is one conditional upsert: the conflict's row lock serialises a requester's
--   concurrent charges, and zero rows returned is the refusal. The window opens at the requester's first charge and
--   a charge after its end opens the next one, so a row is reused rather than accumulated. A refused charge leaves
--   the row untouched. `refund` gives back, under the same lock, the calls a request did not make, so `spent` may
--   return to zero but never below it.
--
-- ── `requester_id` is the app-user ULID, or a `svc_*` id ─────────────────────────────────────────
--   The key `resolveRequesterId` gives, as `fetch_requesters` uses. It is personal data, so the account-erasure
--   sweep deletes the row.
--
-- Additive only (ADR-0035): nothing reads this table until the release that ships the guard.

CREATE TABLE IF NOT EXISTS "requester_source_budget" (
    "requester_id" text PRIMARY KEY,
    "spent" integer NOT NULL,
    "window_ends_at" timestamptz NOT NULL,
    CONSTRAINT "requester_source_budget_spends" CHECK ("spent" >= 0)
);

COMMENT ON TABLE "requester_source_budget" IS
    'Source calls each requester caused through live search and PATCH resolve in its current window, charged before the calls are made and refunded for the calls not made. One row per requester, reused when a window ends.';
