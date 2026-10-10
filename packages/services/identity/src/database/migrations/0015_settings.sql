-- 0015 — user settings (ADR-0059, owner ruling D19).
--
-- ⛔ WHY A TABLE OF TYPED COLUMNS. A user's app preferences live on the server so they follow the cook across
-- devices. One row per user and one nullable column per setting keeps every value checkable by the database; a JSONB
-- blob or a key/value table would not, and a partial update of either needs a merge the service must get right.
--
-- ⛔ NO `DEFAULT` ON A SETTING COLUMN. NULL means "never chosen", and the service resolves it to the default in code
-- (`settings/domain/resolveSettings.ts`, published on the wire as `SETTINGS_DEFAULTS`). A default here would be a
-- second copy of the default, and changing it would change the value of every user who never chose one.
--
-- ⚠️ NO ROW IS MADE AT SIGN-UP. A read with no row answers the defaults and writes nothing; the first PATCH creates
-- the row, in one statement that also checks the user is still active.
--
-- ⚠️ NO GRANT. `identity_service` receives SELECT, INSERT, UPDATE and DELETE on every table the migrator creates, from
-- the ALTER DEFAULT PRIVILEGES hook the runner installs before it applies anything (ADR-0039).
--
-- ⚠️ ERASURE. The row is personal data. `eraseIdentityRow` deletes it; a closure (tombstone) keeps it, so an admin
-- reactivation restores the preferences. `ON DELETE CASCADE` covers a hard delete of the user row, which the
-- application never issues (R1) and a test fixture may.
--
-- Additive: a new table, nothing is altered, nothing is backfilled.

CREATE TABLE settings (
    user_id         text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    search_shortcut boolean,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE settings IS 'D19/ADR-0059: personal data; purged by eraseIdentityRow, kept on closure.';
COMMENT ON COLUMN settings.search_shortcut IS
    'NULL means never chosen; the service resolves it to the default in code. Web "/" focuses search when true.';
