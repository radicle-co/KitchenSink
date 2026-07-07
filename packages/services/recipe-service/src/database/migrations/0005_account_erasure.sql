-- 0005: account_erasure_jobs (T122 / C-007)
--
-- Additive delta applied AFTER 0004. Tracks each POST /v1/account/erasure enqueue so the endpoint is
-- idempotent per C-007 (duplicate while queued/running → 202 with the existing job id, NOT a 409). This
-- table is the SINGLE authoritative source for the erasure job status enum. owner_id = app-user ULID
-- (D2, no FK, no local users table).
-- Implements: T122, C-007.

CREATE TABLE "account_erasure_jobs" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "owner_id"   varchar(255) NOT NULL,
    "status"     text DEFAULT 'queued' NOT NULL,
    "attempts"   integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "erasure_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed'))
);

-- At most one in-flight job per user: a duplicate POST while a job is queued/running collides here, so
-- the endpoint returns 202 with the existing job id (no second enqueue).
CREATE UNIQUE INDEX "idx_erasure_jobs_active_owner" ON "account_erasure_jobs"
    USING btree ("owner_id") WHERE "status" IN ('queued', 'running');
CREATE INDEX "idx_erasure_jobs_status" ON "account_erasure_jobs"
    USING btree ("status") WHERE "status" IN ('queued', 'running');
