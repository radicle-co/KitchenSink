-- Make the email uniqueness apply only to ACTIVE users (deleted_at IS NULL).
--
-- A soft-deleted user keeps its row (and previously its email reservation) forever, so deleting a
-- user then re-registering with the same email made the new identity's INSERT collide on
-- users_email_unique — which 502'd the user.created webhook and left the new user with no DB row.
-- A partial unique index frees a soft-deleted user's email for reuse while still preventing two
-- ACTIVE users from sharing one.
DROP INDEX IF EXISTS users_email_unique;
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL;
