-- CR-002: add the account-lifecycle states to the user_status enum.
--
-- `tombstoned` = account CLOSURE (recoverable; Clerk identity banned, profile scrubbed to {id, name}).
-- `erased`     = right-to-erasure (irreversible; Clerk identity deleted, profile reduced to {id}).
-- These are NEW values, deliberately distinct from `suspended` (an admin moderation hold that RETAINS PII).
--
-- On PostgreSQL 12+ (RDS runs 16) `ALTER TYPE ... ADD VALUE` MAY run inside a transaction block — the only
-- restriction is that the new value cannot be USED in the same transaction. This migration only ADDS values
-- (no INSERT/UPDATE uses them here), so it is safe under the migration runner's per-file BEGIN/COMMIT wrapper.
-- `IF NOT EXISTS` keeps a re-run a no-op even outside the runner's applied-tracking table.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'tombstoned';
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'erased';
