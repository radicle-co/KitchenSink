-- 0044 — the test-principal REGISTRY (ADR-0040).
--
-- A read model of which app-user ULIDs have presented the signed `public_metadata.testPrincipal === true`
-- claim to THIS service. `AuthMiddleware` upserts a row the first time a test principal is seen by a process.
--
-- ⛔ WHY A REGISTRY WHEN THE CLAIM IS SIGNED. Containment (refusing publish, rate, foreign clone, erasure, …)
-- keys on the claim ALONE, because that direction is fail-closed: a mis-marked real user merely loses writes.
-- The self-purge (`POST /api/v1/account/test-reset`) DESTROYS data with no public carve-out, so it also requires
-- this table to hold the principal. ⛔ That is NOT an independent second witness: the middleware writes the row
-- FROM the claim, so it guards against a process that never registered the principal (or whose registration
-- failed), never against a Clerk user an operator mis-marked. ADR-0040 makes a genuinely independent witness a
-- precondition of any production tenant. The registry also lets SQL that runs with no request in hand — the
-- corroborator readers in `resolutionMappings.dal.ts` and `parseCorrections.dal.ts` — tell a test principal's rows
-- from a real user's.
--
-- ⚠️ `user_id` is an opaque ULID and the table holds nothing else a person could be identified by. It is swept
-- by the account-erasure transaction like every other user-keyed table (a GDPR erasure leaves no row naming
-- the principal), and deliberately NOT by the test purge — the purge must keep the registry agreeing, or the
-- NEXT reset of the same pool slot would 404.
--
-- Additive; no backfill (there are no test principals before this migration ships).

CREATE TABLE test_principals (
    user_id varchar(255) PRIMARY KEY,
    registered_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE test_principals IS
    'ADR-0040: app-user ULIDs that presented the signed testPrincipal claim; the purge requires claim AND row.';
