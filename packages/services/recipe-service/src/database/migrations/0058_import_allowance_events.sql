-- 0058 — the daily import allowance ledger (004 FR-022): one row per unit a user SPENT, so "how many have they spent in
-- the trailing 24 hours" is a sum over this table, decided under a per-user advisory lock (`ImportAllowanceDal`).
--
-- WHY A LEDGER AND NOT A COUNT OVER `recipe_parse_jobs`. 004's plan counted `import_jobs`, which was never built, and a
-- paste's job row is deleted by the TTL purge and by the cook (a count over it would hand the allowance back on every
-- delete). A bulk file import (D-013) is ONE unit and creates no job at all. The allowance is a product fact about the
-- PERSON, so it lives in its own table with its own lifetime.
--
-- ONE ROW PER SPEND. `units` is positive (a paste is 1, a migration file is 1) and `channel` names what spent it, so the
-- 011 OCR sub-quota can count its own channel without a second table. `created_at` is written by the application from the
-- same database-clock reading the decision was made on, never defaulted per statement, so a decision and its record agree.
--
-- ⚠️ ROWS EXPIRE: an event stops counting 24 hours after `created_at`, and the DAL deletes the caller's expired rows under
-- the same lock on every admission. A user who never pastes again keeps at most their last day of rows until account
-- erasure (the erasure sweep and the test-principal purge both delete this table by `user_id`).
--
-- ⛔ NO GRANT HERE. The runner applies as the owner and `ALTER DEFAULT PRIVILEGES` gives the service role DML on every
-- table the owner creates (ADR-0039); recipe has no table policy. A role name written into SQL would also trip
-- `databaseRoleLiterals`. The grant is proven by the LOCAL e2e suite inserting, reading and deleting as the service role.
--
-- Additive and expand-only (ADR-0035): one new table, read and written only by this release's code.

CREATE TABLE import_allowance_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The app-user ULID from the verified token, never a request body field.
    user_id varchar(255) NOT NULL,
    channel text NOT NULL CHECK (channel IN ('paste', 'migration')),
    units integer NOT NULL CHECK (units > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The admission's read and prune: this user's events inside a window, oldest first.
CREATE INDEX import_allowance_events_user_created_idx ON import_allowance_events (user_id, created_at);

COMMENT ON TABLE import_allowance_events IS
    '004 FR-022: one row per unit of the daily import allowance a user spent. An event counts for 24 hours.';
COMMENT ON COLUMN import_allowance_events.created_at IS
    'When the unit was spent, from the database clock read under the per-user lock. The window edge is: older than 24 h is out.';
