-- 0018_erasure_audit_trigger_source.sql (CR-002 / U4a) — the R8 audit fields on account_erasure_jobs.
--
-- Three additive columns recording WHO/WHAT triggered each erasure job and WHEN it was confirmed,
-- independent of the mutable status column (R8 — every lifecycle transition leaves an audit record):
--
--   1. trigger_source — 'user' (the confirmation-gated POST /v1/account/erasure) or 'service' (the
--      deletion-worker's verified service principal via the internal route; KTD-2 / U4a). NOT NULL with a
--      constant DEFAULT 'user' — a metadata-only ADD COLUMN (no table rewrite on PG 11+): every historical
--      row predates the service path and was therefore a user-triggered erasure, the honest default.
--   2. actor — the principal that triggered it: the owner's own ULID for a user erasure, or the signed
--      token's machine actor label for a service erasure. Nullable for safety; the application always
--      writes it on new rows, and existing rows are backfilled below.
--   3. confirmed_at — when the erasure was CONFIRMED (the phrase validated on the user path, or the service
--      token verified on the service path). Set by the application on every new row.
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/account.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. The two nullable columns add without a default; trigger_source adds with a
-- constant default. The backfill then gives every pre-existing row an honest audit value: those rows were
-- all user-triggered (the service path did not exist), with the owner as the actor and confirmation at
-- row creation (the confirmation phrase has been required since U7).

ALTER TABLE "account_erasure_jobs" ADD COLUMN "trigger_source" text NOT NULL DEFAULT 'user';
ALTER TABLE "account_erasure_jobs" ADD COLUMN "actor" varchar(255);
ALTER TABLE "account_erasure_jobs" ADD COLUMN "confirmed_at" timestamptz;

ALTER TABLE "account_erasure_jobs"
    ADD CONSTRAINT "erasure_jobs_trigger_source_check" CHECK ("trigger_source" IN ('user', 'service'));

UPDATE "account_erasure_jobs" SET "actor" = "owner_id" WHERE "actor" IS NULL;
UPDATE "account_erasure_jobs" SET "confirmed_at" = "created_at" WHERE "confirmed_at" IS NULL;
