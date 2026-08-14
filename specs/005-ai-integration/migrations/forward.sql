-- 0001: kitchensink_ai initial schema (feature 005 — AI Integration)
--
-- Hand-authored, ordered DDL — the SOURCE OF TRUTH the in-VPC migration runner applies (repo
-- convention, mirrors packages/services/{identity,recipe-service,food-service}/src/database/
-- migrations/*.sql). The Drizzle definitions in packages/shared/ai-db/src/schema/*.ts drive the
-- ORM/query layer and document the same shapes; THIS file is what runs against the kitchensink_ai
-- logical database on the shared kitchensink-data-{stage} instance.
--
-- Schema, DAOs and this migration live in the SHARED package @kitchensink/ai-db, not in ai-service
-- (F-06, owner decision 2026-08-07): ai-workers must write ai_generation_records too, and it cannot
-- import a NestJS application. Mirrors @kitchensink/identity-db, shared by identity + identity-webhooks.
--
-- Ships to: packages/shared/ai-db/src/migrations/0001_ai_initial.sql (tasks.md T008).
--
-- ── SCOPE BOUNDARY ────────────────────────────────────────────────────────────────────────────────
-- This script does NOT create the logical database or its role. `CREATE DATABASE` cannot run inside a
-- transaction block and is owned by the provisioning layer (CDK/DataStack + the migrate Lambda),
-- exactly as kitchensink_recipes is. This file assumes it is already connected TO kitchensink_ai.
-- See migration-plan.md "Pre-migration checklist" for the provisioning step that must precede it.
--
-- ── DELIBERATE DECISIONS (do not "fix") ───────────────────────────────────────────────────────────
--   * NO foreign keys to any other service's tables. `user_id` stores the app ULID as TEXT with no
--     FK — identical to recipe-service's recipes.owner_id (D2). A cross-database FK is not
--     expressible, and 005 owns no users table.
--   * `output_entity_id` is TEXT, not a typed FK — the recipe/meal-plan lives in another service's
--     database (plan.md §1.4, composition over duplication).
--   * Controlled value sets use TEXT + CHECK, not native enums (repo data-model convention).
--   * user_byok_keys carries a COMPOSITE unique (user_id, provider), never a column-level unique on
--     user_id. The column-level form is a known defect that breaks approved decision D-005 (one key
--     per provider, up to three concurrently). validation.sql asserts this specifically.
--   * mcp_agent_grants uses revoked_at TIMESTAMPTZ, not is_revoked BOOLEAN: it records WHEN, which
--     the audit trail needs, and it is what makes the partial index below expressible.
--
-- Order: extensions -> tables -> indexes.

-- gen_random_uuid() for UUID primary keys. Pre-bootstrapped on the shared instance; a fresh/test DB
-- needs it created here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ai_generation_records: audit + provenance for every generation (FR-022, EU AI Act) ────────────
CREATE TABLE "ai_generation_records" (
    "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"            TEXT NOT NULL,          -- app ULID; no FK (cross-service)
    "job_id"             UUID NOT NULL UNIQUE,
    "idempotency_key"    TEXT NOT NULL UNIQUE,   -- SQS is at-least-once (plan.md §5.1)
    "generation_type"    TEXT NOT NULL CHECK ("generation_type" IN
                             ('recipe', 'meal_plan', 'shopping_list', 'recipe_optimization')),
    "status"             TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN
                             ('pending', 'streaming', 'complete', 'failed')),
    "provider"           TEXT NOT NULL CHECK ("provider" IN ('openai', 'anthropic', 'gemini')),
    "model_id"           TEXT,
    "input_token_count"  INT,
    "output_token_count" INT,
    "estimated_cost_usd" NUMERIC(8, 6),
    "source_prompt_hash" TEXT,                   -- SHA-256 of the SANITIZED prompt; never a raw prompt
    "output_entity_id"   TEXT,                   -- opaque id from the owning service; not an FK
    "output_entity_kind" TEXT CHECK ("output_entity_kind" IN
                             ('recipe', 'meal_plan', 'shopping_list')),
    "acted_via_agent"    TEXT,                   -- MCP client_id when the call came from an agent
    "error_message"      TEXT,
    "started_at"         TIMESTAMPTZ DEFAULT NOW(),
    "completed_at"       TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ DEFAULT NOW()
);

-- ── user_byok_keys: Secrets Manager ARN ONLY — the raw key never enters Postgres (FR-015) ─────────
CREATE TABLE "user_byok_keys" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"     TEXT NOT NULL,
    "provider"    TEXT NOT NULL CHECK ("provider" IN ('openai', 'anthropic', 'gemini')),
    "secret_arn"  TEXT NOT NULL,
    "key_version" INT NOT NULL DEFAULT 1,
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- D-005: one key per (user, provider) — up to three providers concurrently.
    -- A column-level UNIQUE on user_id alone would mean one key per USER and is the defect.
    CONSTRAINT "user_byok_keys_user_provider_unique" UNIQUE ("user_id", "provider")
);

-- ── mcp_agent_grants: OUR authorization record for an external agent (ADR-0012, FR-018/FR-021) ────
-- Renamed from mcp_oauth_consents: the grant is ours, not Clerk's OAuth consent. The two are
-- distinct things and must not share a name.
CREATE TABLE "mcp_agent_grants" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"      TEXT NOT NULL,
    "client_id"    TEXT NOT NULL,               -- DCR-issued OAuth client
    "client_label" TEXT,                        -- display name for the settings UI
    "scopes"       TEXT[] NOT NULL,             -- OUR scopes; Clerk has no custom OAuth scopes
    "granted_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expires_at"   TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at"   TIMESTAMPTZ,                 -- NULL = active; set = revoked (FR-021)
    CONSTRAINT "mcp_agent_grants_user_client_unique" UNIQUE ("user_id", "client_id")
);

-- ── prompt_templates: versioned system prompts ────────────────────────────────────────────────────
-- created_by is retained for the V2 user-fork path (OQ-4) but is not exercised in V1.
CREATE TABLE "prompt_templates" (
    "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "template_key"          TEXT NOT NULL,
    "version"               INT NOT NULL DEFAULT 1,
    "system_prompt"         TEXT NOT NULL,
    "user_prompt_template"  TEXT NOT NULL,
    "model_recommendations" TEXT[],
    "is_active"             BOOLEAN NOT NULL DEFAULT true,
    "created_by"            TEXT,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Composite ONLY. A column-level UNIQUE on template_key would make versioning impossible —
    -- the previous revision declared both, which was self-contradictory.
    CONSTRAINT "prompt_templates_key_version_unique" UNIQUE ("template_key", "version")
);

-- ── indexes ───────────────────────────────────────────────────────────────────────────────────────
-- Plain CREATE INDEX (not CONCURRENTLY): these tables are created empty in the same run, so the
-- build is instantaneous and there are no concurrent writers to block. CONCURRENTLY additionally
-- cannot run inside a transaction block, which would break the all-or-nothing property this
-- migration depends on (see risk-matrix.md R-02).
CREATE INDEX "idx_ai_gen_user" ON "ai_generation_records" ("user_id");
CREATE INDEX "idx_ai_gen_job" ON "ai_generation_records" ("job_id");
CREATE INDEX "idx_ai_gen_status" ON "ai_generation_records" ("status");

CREATE INDEX "idx_mcp_grants_user" ON "mcp_agent_grants" ("user_id");
-- Partial: the hot path is "is this agent's grant still live?". Expressible only because revoked_at
-- is a nullable timestamp rather than a boolean.
CREATE INDEX "idx_mcp_grants_active" ON "mcp_agent_grants" ("user_id", "client_id")
    WHERE "revoked_at" IS NULL;
