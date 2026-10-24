-- 0016 — the Clerk username, the public byline (owner ruling 2026-10-13; plan 2026-10-15-010 D3).
--
-- Clerk is the AUTHORITY for a username: it enforces uniqueness and the character rules, and the app has no rename.
-- This column is a MIRROR, written at sign-up from the token or the `user.created` webhook and kept current by the
-- `user.updated` webhook.
--
-- ⛔ `text`, NOT `citext`. Nothing looks a user up by username, so case-insensitive comparison buys nothing — and it
-- would hide a case-only rename (`Ada` → `ada`) from every SQL comparison the sync makes.
--
-- ⛔ NO UNIQUE INDEX. Clerk already guarantees uniqueness at the source. Two users swapping usernames arrive here as two
-- independent webhook deliveries in any order, and a unique index would fail whichever lands first.
--
-- ⚠️ NULLABLE, NO DEFAULT. NULL means "this user has no username" (an instance that once did not require one), which
-- the byline renders differently from any string. A default would invent a username Clerk never issued.
--
-- ⚠️ NO GRANT. The column inherits the table's privileges (ADR-0039's default-privilege hook).
--
-- ⚠️ ERASURE. `eraseIdentityRow` deletes the `profiles` row, so the username goes with it; a closure keeps it, as it
-- keeps `display_name`.
--
-- Additive: one nullable column, nothing backfilled (nothing is live).

ALTER TABLE profiles ADD COLUMN username text;

COMMENT ON COLUMN profiles.username IS
    'Mirror of the Clerk username (the public byline). Clerk is the authority; no unique index by design.';
