-- 0000: kitchensink_food schema (feature 003 — USDA food data)
--
-- Hand-authored, ordered DDL — the source of truth the in-VPC migration runner applies (repo
-- convention, mirrors packages/services/identity/src/database/migrations/*.sql). This is NOT a
-- drizzle-kit journal: the Drizzle definitions in src/db/schema/usda.ts drive the ORM/query layer
-- and document the same shapes (incl. the CHECK constraints), but this file is what runs against
-- the kitchensink_food database on the shared kitchensink-data-{stage} instance.
--
-- Order: extension → tables (with CHECK constraints) → indexes → singleton seed.
-- Tables: foods, fetch_queue, fetch_requesters, usda_sync_metadata, usda_call_log.
-- Implements: FR-014, FR-015, FR-019, FR-028, FR-029.

-- pg_trgm powers fuzzy search (FR-029). Pre-bootstrapped on the shared instance; a fresh/test DB
-- needs it created here.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Local USDA food data store (FR-028). One row per FDC id.
CREATE TABLE "foods" (
    "fdc_id" integer PRIMARY KEY NOT NULL,
    "description" text,
    "data_type" text,
    "fetch_status" text DEFAULT 'pending' NOT NULL,
    "upc_code" text,
    "brand_owner" text,
    "brand_name" text,
    "calories" numeric,
    "protein_g" numeric,
    "carbs_g" numeric,
    "fat_g" numeric,
    "fiber_g" numeric,
    "sodium_mg" numeric,
    "sugar_g" numeric,
    "saturated_fat_g" numeric,
    "cholesterol_mg" numeric,
    "vitamin_a_iu" numeric,
    "vitamin_c_mg" numeric,
    "calcium_mg" numeric,
    "iron_mg" numeric,
    "raw_json" jsonb,
    "search_vector" "tsvector",
    "request_count" integer DEFAULT 0 NOT NULL,
    "fetched_at" timestamp with time zone,
    "last_requested_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "foods_fetch_status_check" CHECK ("foods"."fetch_status" IN ('pending', 'fetched', 'not_found', 'failed', 'stale'))
);

-- Demand-weighted Postgres-as-queue (FR-014, FR-015). Dedup via ON CONFLICT (fdc_id).
CREATE TABLE "fetch_queue" (
    "fdc_id" text PRIMARY KEY NOT NULL,
    "request_count" integer DEFAULT 1 NOT NULL,
    "first_requested" timestamp with time zone DEFAULT now() NOT NULL,
    "last_requested" timestamp with time zone DEFAULT now() NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "fetched_at" timestamp with time zone,
    CONSTRAINT "fetch_queue_status_check" CHECK ("fetch_queue"."status" IN ('pending', 'in_flight', 'tombstone'))
);

-- Distinct-requester demand (FR-044) + per-sub pending-count source for fairness-by-demotion.
CREATE TABLE "fetch_requesters" (
    "fdc_id" text NOT NULL,
    "sub" text NOT NULL,
    "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "fetch_requesters_fdc_id_sub_pk" PRIMARY KEY("fdc_id","sub")
);

-- Singleton sync-metadata (id = 1) — last full/incremental sync + per-dataset USDA versions.
CREATE TABLE "usda_sync_metadata" (
    "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
    "last_full_sync_at" timestamp with time zone,
    "last_incremental_at" timestamp with time zone,
    "foundation_version" text,
    "sr_legacy_version" text,
    "branded_version" text
);

-- Rolling 60-minute USDA-call window (FR-019, FR-020). One row per USDA call.
CREATE TABLE "usda_call_log" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "called_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes (FR-015, FR-029).
CREATE INDEX "idx_fetch_queue_priority" ON "fetch_queue" USING btree ("request_count" DESC,"first_requested" ASC) WHERE "fetch_queue"."status" = 'pending';
CREATE INDEX "idx_fetch_requesters_sub" ON "fetch_requesters" USING btree ("sub");
CREATE INDEX "idx_foods_fetch_status_fetched_at" ON "foods" USING btree ("fetch_status","fetched_at");
CREATE INDEX "idx_foods_last_requested" ON "foods" USING btree ("last_requested_at");
CREATE INDEX "idx_foods_search" ON "foods" USING gin ("search_vector");
CREATE INDEX "idx_foods_data_type" ON "foods" USING btree ("data_type");
CREATE INDEX "idx_foods_upc" ON "foods" USING btree ("upc_code");
CREATE INDEX "idx_usda_call_log_called_at" ON "usda_call_log" USING btree ("called_at");

-- Seed the usda_sync_metadata singleton (id = 1). Drizzle migrations don't seed data, so the
-- ordered SQL owns it. Idempotent via ON CONFLICT (FR-019).
INSERT INTO "usda_sync_metadata" ("id") VALUES (1) ON CONFLICT DO NOTHING;
