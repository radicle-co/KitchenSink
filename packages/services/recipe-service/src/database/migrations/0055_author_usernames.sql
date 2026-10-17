-- 0055_author_usernames.sql — the byline's username copies (owner ruling 2026-10-13; plan 2026-10-15-010 D7).
--
-- The Clerk username is the public byline ("@username"); the display name stays public beside it. Identity owns
-- both and publishes them together as one handle-sync SNAPSHOT; this database keeps the same three copies of the
-- username that 0015 keeps of the display name:
--
--   * author_handles.username        — the read model, written ONLY by the handle-sync consumer.
--   * recipes.author_username        — the recipe author's username, written at create/clone, corrected by fan-out.
--   * recipe_versions.editor_username — the version editor's, beside editor_handle and for the same reason: a
--     COLUMN, never a field inside the immutable snapshot, so the fan-out can correct it.
--
-- ⛔ NO `collections.source_owner_username`. 0016 FREEZES the source owner's display name onto a clone, which is
-- right for a label. A username is a reusable IDENTIFIER that Clerk lets a user change, so a frozen "@name" could
-- come to point at a different real person. The collection read resolves the source owner's CURRENT username
-- through `author_handles` instead, and a deleted source yields none.
--
-- ⛔ `text`, NOT `citext`: a display copy is never a lookup key, and this database has no citext extension.
-- ⚠️ NULLABLE, NO DEFAULT: NULL means "no username known"; the byline renders that state, and nothing may invent one.
-- ⚠️ ERASURE: the sweep CLEARS both copies to NULL on kept rows (never a pseudonym — `user_<ULID>` is a legal Clerk
-- username, so a pseudonym could impersonate a real person), and the `author_handles` row delete takes its column.
-- ⚠️ The display-name columns keep their `*_handle` names: renaming a column is a contracting migration under
-- ADR-0035, and the wire fields were renamed instead (`authorDisplayName`).
--
-- Additive and expand-only: three nullable columns, nothing backfilled (nothing is live).

ALTER TABLE author_handles ADD COLUMN username text;

ALTER TABLE recipes ADD COLUMN author_username text;

ALTER TABLE recipe_versions ADD COLUMN editor_username text;
