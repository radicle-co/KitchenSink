-- 0058 — the daily import allowance ledger (004 FR-022, ADR-0072 §8): one row per spend, so "how many have they spent in
-- the trailing 24 hours on this channel" is a sum over this table, decided under a per-user advisory lock
-- (`ImportAllowanceDal`). Two channels, each with its own limit and its own rows: `paste` (200 a rolling day, one unit
-- per paste) and `bulk` (1,000 recipes a rolling day, one unit per recipe; `/api/v1/import`). They never borrow from
-- each other.
--
-- WHY A LEDGER AND NOT A COUNT OVER `recipe_parse_jobs`. 004's plan counted `import_jobs`, which was never built, and a
-- paste's job row is deleted by the TTL purge and by the cook (a count over it would hand the allowance back on every
-- delete). A bulk import's recipes are each paid for when their lines are first sent for parsing, and the import's own
-- rows are not the ledger (they can be deleted too). The allowance is a product fact about the PERSON, so it lives in
-- its own table with its own lifetime.
--
-- ONE ROW PER SPEND. `units` is positive (a paste is 1; a bulk spend is the number of recipes admitted at once, which a
-- file larger than the room left makes smaller than the file) and `channel` names what spent it, so the 011 OCR
-- sub-quota can count its own channel without a second table. The channel is a closed set: adding one is a migration
-- AND a limit in `IMPORT_ALLOWANCE_LIMITS` (a `Record` over the union, so a channel without a limit does not compile). `created_at` is written by the application from the
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
    channel text NOT NULL CHECK (channel IN ('paste', 'bulk')),
    units integer NOT NULL CHECK (units > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The admission's read and prune: this user's events inside a window, oldest first.
CREATE INDEX import_allowance_events_user_created_idx ON import_allowance_events (user_id, created_at);

COMMENT ON TABLE import_allowance_events IS
    '004 FR-022: one row per unit of the daily import allowance a user spent. An event counts for 24 hours.';
COMMENT ON COLUMN import_allowance_events.created_at IS
    'When the unit was spent, from the database clock read under the per-user lock. The window edge is: older than 24 h is out.';
