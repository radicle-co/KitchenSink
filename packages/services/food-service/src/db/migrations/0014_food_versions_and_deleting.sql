-- 0014: authored-food versioning + the DELETING tombstone (plan U18, R21/R22/Q3b; KTD-I).
--
-- Hand-authored, ordered DDL applied once by the in-VPC migration runner (single BEGIN/COMMIT around the
-- file; no transaction of its own). Drizzle mirror: src/db/schema/food.ts.
--
-- ── food_versions: the recipe versioning pattern's TABLE half, and ONLY the table half (KTD-I) ─────
--   Create writes version 1 and every edit appends the new content as version N+1 — the recipe
--   pattern's shape: each row IS that version's content, so a promoted food's nutrition shift under
--   referencing recipes has the full history as recourse (R21 — the accepted residual risk, with this
--   table as the recorded mitigation). Deliberately absent, vs the recipe
--   original: `s3_key` and the archive worker (macro-sized rows; the S3 half is a new VPC Lambda = a NAT
--   consumer amendment, explicitly deferred until version volume warrants it — the table is shaped so
--   archival bolts on later), and `base_version` (no restore flow exists for foods yet).
--
--   ⚠️ `created_by` is NULLABLE, unlike the recipe original, because the erasure sweep NULLs it: a KEPT
--   (referenced) food's version history survives its author's erasure — it is the recourse OTHER users'
--   recipes rely on — but the attribution goes. The recipe pattern scrubs a display HANDLE and keeps the
--   pseudonymous ULID; food versions have no handle column, so the sweep's de-identifying write lands on
--   the id itself and NULL is the swept state.
--
-- ── DELETING: the tombstone-first refusal window (Q3b / R22) ───────────────────────────────────────
--   Both delete flows (voluntary DELETE and erasure) flip the food RESOLVED → DELETING FIRST, so
--   `by-food` admission — which reads the golden record and refuses anything not RESOLVED — cannot bind
--   the food while the cross-service reference check runs. That refusal window is what closes the
--   check-then-delete TOCTOU race. DELETING reverts only to RESOLVED (the referenced/kept outcome) or
--   ends in physical DELETE; `LEGAL_PRIORS` in food.dao.ts carries the same rule as a guarded UPDATE.
--
--   ⚠️ ALTER TYPE … ADD VALUE inside the runner's transaction is legal on PostgreSQL 12+ (the pre-12
--   "cannot run inside a transaction block" restriction was lifted; the value only becomes usable after
--   commit, which is exactly the runner's boundary). 0005 established the same pattern.

ALTER TYPE food_status ADD VALUE IF NOT EXISTS 'DELETING';

CREATE TABLE "food_versions" (
    "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "food_id"        text NOT NULL REFERENCES "food"("id") ON DELETE CASCADE,
    "version_number" integer NOT NULL,
    -- That version's content: { name, description, macros, portions }.
    "snapshot"       jsonb NOT NULL,
    -- The editing author's app-user ULID; NULLed by the erasure sweep on kept foods (see header).
    "created_by"     varchar(255),
    "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "food_versions_food_version_unique" UNIQUE ("food_id", "version_number")
);

CREATE INDEX "idx_food_versions_food" ON "food_versions" ("food_id");
-- The erasure sweep's predicate (NULL created_by on the erased author's rows). Partial: most rows keep
-- their author and never match.
CREATE INDEX "idx_food_versions_created_by" ON "food_versions" ("created_by") WHERE "created_by" IS NOT NULL;
