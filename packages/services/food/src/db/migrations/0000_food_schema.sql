-- 0000: kitchensink_food schema (feature 003 — source-agnostic food data)
--
-- Hand-authored, ordered DDL — the SOURCE OF TRUTH the in-VPC migration runner applies (repo
-- convention, mirrors packages/services/identity/src/database/migrations/*.sql). This is NOT a
-- drizzle-kit journal: the Drizzle definitions in src/db/schema/{food,operational,food-candidates}.ts
-- drive the ORM/query layer and document the same shapes; this file is what runs against the
-- kitchensink_food database on the shared kitchensink-data-{stage} instance.
--
-- Mirrors plan.md §2 EXACTLY (every type, constraint, index) incl. the stabilization hardening:
-- D-PROVENANCE-FK (composite same-food FKs + UNIQUE(food_id, id)), D-LEASE (fetch_queue.leased_at +
-- reaper partial index), D-CANDIDATES (food_candidates = the 13th table), DB-5 (nutrient dedup),
-- DB-6 (amount/gram_weight CHECKs), DB-7 (operational text+CHECK columns), DB-8 (reaper partial index).
--
-- Order: extension -> enums -> canonical core tables -> operational tables -> food_candidates -> indexes.
-- Tables (13): food, food_sources, nutrient, food_nutrients, food_portions, food_field_provenance,
--   food_category, food_category_assignment, food_candidates, fetch_queue, fetch_requesters,
--   source_call_log, source_sync_metadata.
-- Implements: FR-005 FR-008 FR-010 FR-013 FR-014 FR-015 FR-016 FR-018 FR-019 FR-020 FR-025a
--   FR-028 FR-029 FR-032 FR-043 FR-044 FR-IDN-1 FR-IDN-3 FR-MRG-5 FR-RES-1 FR-RES-2 SC-008 SC-013.

-- pg_trgm powers fuzzy/substring/partial search (FR-008/FR-010). Pre-bootstrapped on the shared
-- instance; a fresh/test DB needs it created here (must precede the GIN trigram indexes below).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Controlled enums (DB-7: domain-model controlled sets use enums) ──────────────────────────────
CREATE TYPE "food_status"    AS ENUM ('PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED');
CREATE TYPE "food_kind"      AS ENUM ('generic', 'branded');
CREATE TYPE "food_source"    AS ENUM ('usda');
CREATE TYPE "food_field"     AS ENUM ('name', 'description', 'kind', 'brand_owner', 'brand_name', 'barcode');
CREATE TYPE "nutrient_basis" AS ENUM ('per_100g', 'per_serving');

-- ── food: the golden record (internal id PK) ─────────────────────────────────────────────────────
CREATE TABLE "food" (
    "id"              text PRIMARY KEY NOT NULL,
    "name"            text,
    "normalized_name" text NOT NULL,
    "description"     text,
    "kind"            "food_kind" DEFAULT 'generic' NOT NULL,
    "brand_owner"     text,
    "brand_name"      text,
    "barcode"         text,
    "status"          "food_status" DEFAULT 'PENDING' NOT NULL,
    "tombstoned_at"   timestamp with time zone,
    "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at"      timestamp with time zone DEFAULT now() NOT NULL
);

-- ── food_sources: the crosswalk (NO raw payload). UNIQUE(food_id, id) is the composite target for the
--    per-value same-food provenance FKs (D-PROVENANCE-FK). ──────────────────────────────────────────
CREATE TABLE "food_sources" (
    "id"           text PRIMARY KEY NOT NULL,
    "food_id"      text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "source"       "food_source" NOT NULL,
    "external_key" text NOT NULL,
    "fetch_state"  text DEFAULT 'fetched' NOT NULL,
    "item_version" text,
    "fetched_at"   timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_sources_source_key_unique" UNIQUE ("source", "external_key"),
    CONSTRAINT "food_sources_food_id_id_unique"  UNIQUE ("food_id", "id"),
    CONSTRAINT "food_sources_fetch_state_check"  CHECK ("fetch_state" IN ('fetched', 'error'))
);

-- ── nutrient: the dictionary (units live here, once). DB-5 dedup: external_code when present, else
--    (name, unit). ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE "nutrient" (
    "id"            text PRIMARY KEY NOT NULL,
    "name"          text NOT NULL,
    "unit"          text NOT NULL,
    "external_code" text,
    CONSTRAINT "nutrient_code_unique"      UNIQUE ("external_code"),
    CONSTRAINT "nutrient_name_unit_unique" UNIQUE ("name", "unit")
);

-- ── food_nutrients: normalized values with per-value provenance (composite same-food FK, DB-6 CHECK).
CREATE TABLE "food_nutrients" (
    "id"          text PRIMARY KEY NOT NULL,
    "food_id"     text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "nutrient_id" text NOT NULL REFERENCES "nutrient"("id"),
    "amount"      numeric NOT NULL,
    "basis"       "nutrient_basis" DEFAULT 'per_100g' NOT NULL,
    "source_id"   text NOT NULL,
    CONSTRAINT "food_nutrients_food_nutrient_unique" UNIQUE ("food_id", "nutrient_id"),
    CONSTRAINT "food_nutrients_amount_nonneg" CHECK ("amount" >= 0),
    CONSTRAINT "food_nutrients_provenance_same_food_fk"
        FOREIGN KEY ("food_id", "source_id") REFERENCES "food_sources" ("food_id", "id") ON DELETE NO ACTION
);

-- ── food_portions: household measures / serving sizes (composite same-food FK, DB-6 CHECK). ───────
CREATE TABLE "food_portions" (
    "id"          text PRIMARY KEY NOT NULL,
    "food_id"     text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "label"       text NOT NULL,
    "gram_weight" numeric NOT NULL,
    "source_id"   text NOT NULL,
    CONSTRAINT "food_portions_gram_weight_pos" CHECK ("gram_weight" > 0),
    CONSTRAINT "food_portions_provenance_same_food_fk"
        FOREIGN KEY ("food_id", "source_id") REFERENCES "food_sources" ("food_id", "id") ON DELETE NO ACTION
);

-- ── food_field_provenance: scalar-field provenance side-table (composite same-food FK). ───────────
CREATE TABLE "food_field_provenance" (
    "food_id"   text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "field"     "food_field" NOT NULL,
    "source_id" text NOT NULL,
    CONSTRAINT "food_field_provenance_pk" PRIMARY KEY ("food_id", "field"),
    CONSTRAINT "food_field_provenance_same_food_fk"
        FOREIGN KEY ("food_id", "source_id") REFERENCES "food_sources" ("food_id", "id") ON DELETE NO ACTION
);

-- ── food_category + assignment (many-to-many classification). ─────────────────────────────────────
CREATE TABLE "food_category" (
    "id"   text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    CONSTRAINT "food_category_name_unique" UNIQUE ("name")
);

-- source_id is nullable -> the composite same-food FK uses MATCH SIMPLE (default): enforcement is
-- skipped when source_id IS NULL, enforced (same-food) when present (D-PROVENANCE-FK).
CREATE TABLE "food_category_assignment" (
    "food_id"     text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "category_id" text NOT NULL REFERENCES "food_category"("id") ON DELETE CASCADE,
    "source_id"   text,
    CONSTRAINT "food_category_assignment_pk" PRIMARY KEY ("food_id", "category_id"),
    CONSTRAINT "food_category_assignment_same_food_fk"
        FOREIGN KEY ("food_id", "source_id") REFERENCES "food_sources" ("food_id", "id") ON DELETE NO ACTION
);

-- ── fetch_queue: demand-weighted Postgres-as-queue, keyed on food id (FR-014/FR-015). leased_at is the
--    worker lease stamp (D-LEASE); status is an operational text+CHECK column (DB-7). ────────────────
CREATE TABLE "fetch_queue" (
    "food_id"         text PRIMARY KEY NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "request_count"   integer DEFAULT 1 NOT NULL,
    "first_requested" timestamp with time zone DEFAULT now() NOT NULL,
    "last_requested"  timestamp with time zone DEFAULT now() NOT NULL,
    "status"          text DEFAULT 'pending' NOT NULL,
    "attempts"        integer DEFAULT 0 NOT NULL,
    "last_error"      text,
    "fetched_at"      timestamp with time zone,
    "leased_at"       timestamp with time zone,
    CONSTRAINT "fetch_queue_status_check" CHECK ("status" IN ('pending', 'in_flight', 'tombstone'))
);

-- ── fetch_requesters: distinct-requester demand + per-sub pending count + WS targeting. ──────────
CREATE TABLE "fetch_requesters" (
    "food_id"      text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "sub"          text NOT NULL,
    "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "fetch_requesters_pk" PRIMARY KEY ("food_id", "sub")
);

-- ── source_call_log: per-source rolling 60-min window (FR-019/FR-020). ───────────────────────────
CREATE TABLE "source_call_log" (
    "id"        bigserial PRIMARY KEY NOT NULL,
    "source"    "food_source" NOT NULL,
    "called_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── source_sync_metadata: source-neutral sync tracking (FR-IDN-3); one row per source. ───────────
CREATE TABLE "source_sync_metadata" (
    "source"              "food_source" PRIMARY KEY NOT NULL,
    "last_full_sync_at"   timestamp with time zone,
    "last_incremental_at" timestamp with time zone,
    "source_version"      text
);

-- ── food_candidates: per-source candidate set backing UNRESOLVED / disambiguation (D-CANDIDATES). ──
CREATE TABLE "food_candidates" (
    "id"           text PRIMARY KEY NOT NULL,
    "food_id"      text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "source"       "food_source" NOT NULL,
    "external_key" text NOT NULL,
    "name"         text NOT NULL,
    "summary"      text,
    "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_candidates_food_source_key_unique" UNIQUE ("food_id", "source", "external_key")
);

-- ── Indexes (search + lifecycle + queue + limiter) ───────────────────────────────────────────────
-- food: dedup, lifecycle filter, barcode lookup, and pg_trgm fuzzy search (FR-005/FR-008/FR-010/FR-029).
CREATE UNIQUE INDEX "food_normalized_name_unique" ON "food" USING btree ("normalized_name");
CREATE INDEX "food_status_idx"            ON "food" USING btree ("status");
CREATE INDEX "food_barcode_idx"           ON "food" USING btree ("barcode") WHERE "barcode" IS NOT NULL;
CREATE INDEX "food_name_trgm_idx"         ON "food" USING gin ("name" gin_trgm_ops);
CREATE INDEX "food_description_trgm_idx"  ON "food" USING gin ("description" gin_trgm_ops);

-- crosswalk + provenance read paths (FR-029/R7).
CREATE INDEX "food_sources_food_id_idx"      ON "food_sources" USING btree ("food_id");
CREATE INDEX "food_nutrients_food_id_idx"    ON "food_nutrients" USING btree ("food_id");
CREATE INDEX "food_nutrients_source_id_idx"  ON "food_nutrients" USING btree ("source_id");
CREATE INDEX "food_portions_food_id_idx"     ON "food_portions" USING btree ("food_id");
CREATE INDEX "food_candidates_food_id_idx"   ON "food_candidates" USING btree ("food_id");

-- queue: demand-weighted drain (FR-015) + reaper / in_flight-reclaim access path (DB-8).
CREATE INDEX "idx_fetch_queue_priority"
    ON "fetch_queue" USING btree ("request_count" DESC, "first_requested" ASC) WHERE "status" = 'pending';
CREATE INDEX "idx_fetch_queue_inflight_lease"
    ON "fetch_queue" USING btree ("leased_at") WHERE "status" = 'in_flight';

-- fairness (live per-sub pending count) + per-source rolling-window count + prune (FR-019/FR-020/FR-043).
CREATE INDEX "idx_fetch_requesters_sub"            ON "fetch_requesters" USING btree ("sub");
CREATE INDEX "idx_source_call_log_source_called_at" ON "source_call_log" USING btree ("source", "called_at");
