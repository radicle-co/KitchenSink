-- 0013 — the handle-sync OWED marker (plan U9, R21/R25).
--
-- ⛔ WHY. A rename publishes to the handle-sync topic AFTER the profile write commits, and the publish is
-- deliberately best-effort: a failed fan-out must not fail the user's rename. The consequence, until now, was
-- that a failed publish left NOTHING behind. The cook's name changed in identity and never changed on their
-- recipes, and the only trace was one `logger.error` in a log nobody reads. `users.service.ts` said the
-- reconciliation backstops it; there is no reconciliation for display names.
--
-- So the rename now records that a sync is OWED, in the SAME statement that changes the name. The publish
-- clears it on success and leaves it with a reason on failure, and the backstop (U12) reads exactly the rows
-- where it is still set.
--
-- ⛔ ON `profiles`, NOT A NEW TABLE, and the reason is the transaction. ADR-0034's outbox rule is that the
-- record and the thing it describes move together or not at all; a separate table would be a second write
-- that a reader could — and eventually would — put outside the transaction. Here the marker is a column on
-- the row being renamed, so "set it in the same statement" is the only way to write it at all.
--
-- ⛔ `handle_sync_owed_at` IS A TIMESTAMP, NOT A BOOLEAN. A second rename while the first publish is still
-- failing must keep the NEWER intent — a boolean cannot say which name is owed, and the backstop needs the
-- age to know whether the debt is stale or seconds old. The value is the profile's own `updated_at`, which
-- is the same monotonic clock the published `sourceTimestamp` carries, so the two can be compared.
--
-- ⚠️ `handle_sync_failure_code` is a CODE, never a message: it is read by an operator and by the backstop's
-- classifier, and an exception's text can carry a display name, which is the one thing that must not be
-- copied anywhere new (see the erasure note below).
--
-- ⚠️ ERASURE. Both columns live on `profiles`, which the erasure path already deletes wholesale — so a
-- GDPR erasure takes the marker with the row and no new sweep is owed. `handle_sync_failure_code` is a
-- closed vocabulary and holds no user text, so nothing here widens what an erasure must reach.
--
-- Additive, nullable, no backfill: every existing profile reads NULL, which means "nothing owed".

ALTER TABLE profiles
    ADD COLUMN handle_sync_owed_at timestamptz,
    ADD COLUMN handle_sync_failure_code text;

CREATE INDEX profiles_handle_sync_owed_idx
    ON profiles (handle_sync_owed_at)
    WHERE handle_sync_owed_at IS NOT NULL;

COMMENT ON COLUMN profiles.handle_sync_owed_at IS
    'U9: set with the rename when a handle sync is owed; cleared by a successful publish. NULL means nothing owed.';
COMMENT ON COLUMN profiles.handle_sync_failure_code IS
    'U9: why the last publish failed, as a code. Never a message — an exception text can carry a display name.';
