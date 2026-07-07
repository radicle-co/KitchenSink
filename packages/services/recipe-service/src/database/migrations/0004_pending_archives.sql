-- 0004: recipe_version_pending_archives (T121 / FR-007b-i)
--
-- Additive delta applied AFTER 0003. Tracks recipe-version snapshots written to PostgreSQL but not yet
-- archived to S3. The recipe save transaction is the source of truth; S3 archiving is asynchronous and
-- retried via SQS until success. UNIQUE(recipe_version_id) — one pending row per version, NO duplicated
-- snapshot column (the snapshot lives on recipe_versions).
-- Implements: T121, FR-007b-i.

CREATE TABLE "recipe_version_pending_archives" (
    "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "recipe_version_id" uuid NOT NULL REFERENCES "recipe_versions"("id") ON DELETE CASCADE,
    "recipe_id"         uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
    "version_number"    integer NOT NULL,
    "status"            text DEFAULT 'pending' NOT NULL,
    "attempts"          integer DEFAULT 0 NOT NULL,
    "last_error"        text,
    "next_attempt_at"   timestamp with time zone DEFAULT now() NOT NULL,
    "sqs_message_id"    text,
    "sqs_receipt"       text,
    "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "pending_archives_status_check" CHECK ("status" IN ('pending', 'in_flight', 'failed', 'dlq')),
    CONSTRAINT "recipe_version_pending_archives_version_unique" UNIQUE ("recipe_version_id")
);

CREATE INDEX "idx_pending_archives_status_next" ON "recipe_version_pending_archives"
    USING btree ("status", "next_attempt_at") WHERE "status" IN ('pending', 'failed');
CREATE INDEX "idx_pending_archives_recipe_id" ON "recipe_version_pending_archives" USING btree ("recipe_id");
