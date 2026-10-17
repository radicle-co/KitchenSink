-- ⚠️  WARNING: THIS ROLLBACK IS DESTRUCTIVE.
--
-- forward.sql creates four tables. Undoing it means DROP TABLE, which destroys every row written
-- since. On a never-used database that is a no-op; the moment ai-service has served a single
-- request it is permanent data loss. Take a backup before applying forward.sql, and take another
-- before applying THIS file.
--
-- What is lost, and why each matters:
--   * ai_generation_records — the EU AI Act / FR-022 provenance trail. This is compliance evidence,
--     not cache. It cannot be reconstructed from any other source: 005 stores only the SHA-256 of
--     the sanitized prompt, and the generated entity lives in another service keyed by an opaque
--     output_entity_id that this table is the only index of.
--   * mcp_agent_grants — every external agent authorization. Dropping it does NOT revoke anything
--     at the OAuth layer; it destroys OUR record of what was granted while the agent's credential
--     may still be live. See the mandatory pre-step below.
--   * user_byok_keys — see ORPHANED SECRETS below. Dropping this table LEAKS money and secrets.
--   * prompt_templates — recoverable from source control if templates are seeded; if any template
--     was authored in-place (the V2 user-fork path, OQ-4), it is not.
--
-- ── MANDATORY PRE-STEP 1: ORPHANED SECRETS MANAGER ENTRIES ────────────────────────────────────────
-- user_byok_keys stores ONLY the ARN; the key material lives in AWS Secrets Manager. Postgres has no
-- knowledge of, and no authority over, that secret. DROP TABLE therefore severs the only pointer we
-- have to those secrets, leaving them:
--   (a) billed indefinitely (per-secret monthly charge, forever), and
--   (b) holding LIVE third-party provider credentials that no longer appear in any inventory —
--       a security exposure, not merely a cost leak.
-- BEFORE running this script, capture the ARNs and schedule their deletion:
--
--     -- 1. Export first. Run this and KEEP the output somewhere durable.
--     --    (`\copy` is psql-side, so it needs no server filesystem permission.)
--     \copy (SELECT user_id, provider, secret_arn FROM user_byok_keys) TO 'byok-arns-backup.csv' CSV HEADER
--
--     -- 2. Then, per ARN, outside Postgres:
--     --    aws secretsmanager delete-secret --secret-id <arn> --recovery-window-in-days 30
--     --    (Do NOT pass --force-delete-without-recovery. The 30-day window is the only
--     --     undo you get if this rollback is itself rolled back.)
--
-- ── MANDATORY PRE-STEP 2: REVOKE AGENT GRANTS AT THE AUTHORIZATION LAYER ──────────────────────────
-- Dropping mcp_agent_grants does not tell any external agent to stop. Revoke first, then drop, or
-- agents keep presenting credentials against a service that has lost its record of the grant.
--
--     \copy (SELECT user_id, client_id, scopes FROM mcp_agent_grants WHERE revoked_at IS NULL) TO 'live-grants-backup.csv' CSV HEADER
--
-- Only after BOTH pre-steps have completed should the DDL below run.

BEGIN;

-- Reverse creation order. No FKs exist between these tables (by design), so order is not strictly
-- forced — it is reversed for symmetry with forward.sql and to keep review diffs readable.
DROP TABLE IF EXISTS "prompt_templates";
DROP TABLE IF EXISTS "mcp_agent_grants";
DROP TABLE IF EXISTS "user_byok_keys";
DROP TABLE IF EXISTS "ai_generation_records";

-- Indexes are dropped implicitly with their tables — listing them separately would fail.

-- pgcrypto is deliberately NOT dropped. It is bootstrapped on the shared instance and other logical
-- databases on it depend on gen_random_uuid(). Dropping it here would be a cross-database outage
-- caused by a single service's rollback.

COMMIT;

-- The logical database kitchensink_ai and its role are NOT dropped here, mirroring the scope
-- boundary in forward.sql: their lifecycle belongs to the provisioning layer (CDK/DataStack).
