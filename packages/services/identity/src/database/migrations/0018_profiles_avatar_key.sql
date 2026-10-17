-- 0018 — an uploaded avatar is stored as its object KEY, not a URL (ADR-0064).
--
-- The response field `avatarUrl` is composed at READ time from this key and the media CDN's base URL, so the CDN host is
-- configuration and can change without touching a row. `avatar_url` keeps holding Clerk's picture URL ONLY.
--
-- ⛔ TWO CHECKS make the invalid states unrepresentable, rather than a rule every writer must remember:
--   * `profiles_avatar_key_xor_url` — a profile holds a Clerk picture URL OR an uploaded key, never both. Both would
--     mean two sources of truth for one image, and the read-time composition would have to pick between them. The
--     writers keep it true in one statement each: an upload sets the key and clears the URL, and a real Clerk picture
--     change sets the URL and clears the key ("Clerk wins on a real change", plan D5).
--   * `profiles_avatar_key_own_prefix` — the key lies under THIS user's own `avatars/{user_id}/` prefix. The API
--     refuses a foreign key before it gets here; this is the second lock, so a bug in that refusal cannot display
--     another user's photograph, or a recipe photo, as one's own. `user_id` is a ULID (no `%`, no `_`), so the LIKE
--     pattern cannot be widened by the value.
--
-- ⚠️ NULLABLE, NO DEFAULT. NULL means "no uploaded avatar". A default would invent a key nobody uploaded.
--
-- ⚠️ NO GRANT. The column inherits the table's privileges (ADR-0039's default-privilege hook).
--
-- ⚠️ ERASURE. `eraseIdentityRow` deletes the `profiles` row, so the key goes with it; a closure keeps the row and
-- clears both avatar columns (`computeProfileScrub`). The OBJECTS under the prefix are deleted by the service.
--
-- Additive: one nullable column and two constraints that no existing row can violate (every row has a NULL key).

ALTER TABLE profiles ADD COLUMN avatar_key text;

ALTER TABLE profiles
    ADD CONSTRAINT profiles_avatar_key_xor_url CHECK (avatar_key IS NULL OR avatar_url IS NULL);

ALTER TABLE profiles
    ADD CONSTRAINT profiles_avatar_key_own_prefix CHECK (avatar_key IS NULL OR avatar_key LIKE 'avatars/' || user_id || '/%');

COMMENT ON COLUMN profiles.avatar_key IS
    'S3 object key of the uploaded avatar (avatars/{user_id}/{ts}.{ext}); the URL is composed at read time. NULL = none.';
