-- 0015_author_editor_handles.sql (W8-a.2 / owner decision 6) — denormalized author/editor handles.
--
-- The "by @handle" the recipe list/search/collection cards and the version-history attribution show is
-- the identity service's profiles.displayName, DENORMALIZED here at write time so the read paths need no
-- cross-service call (the rejected alternative). Three additions:
--
--   * recipes.author_handle          — the recipe author's display name, written on create/clone.
--   * recipe_versions.editor_handle  — the version editor's display name, written per version. A COLUMN,
--     deliberately NOT a field inside the immutable snapshot JSONB — a handle frozen in the snapshot could
--     never be corrected by the rename-sync path, permanently freezing attribution.
--   * author_handles(user_id,...)    — the recipe-DB read model the write path reads locally for the current
--     handle, maintained MONOTONICALLY on source_timestamp by the handle-sync consumer. This closes the
--     write-time-staleness hole: a recipe created AFTER a rename seeds the NEW name, not a stale claim.
--
-- All handle columns are NULLABLE with no default — a pre-existing row has no known handle until its next
-- write (or the backfill) supplies one, and the UI renders the owner id / "unknown" rather than fabricating.
-- author_handles.user_id becomes a user-keyed table → the FOURTH GDPR erasure root (W8-a.10).
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC runner applies these in filename order; the
-- Drizzle definitions in schema/recipes.ts, schema/versions.ts, schema/author-handles.ts document the shape).
-- SAFE AGAINST EXISTING ROWS: two metadata-only ADD COLUMNs + one new table.

ALTER TABLE recipes ADD COLUMN author_handle text;

ALTER TABLE recipe_versions ADD COLUMN editor_handle text;

CREATE TABLE author_handles (
    user_id varchar(255) PRIMARY KEY,
    display_name text NOT NULL,
    -- The profiles.updatedAt written in the SAME transaction as the displayName change (a single clock),
    -- so the consumer's monotonic guard (only apply a strictly-newer timestamp) is race-correct across
    -- both producer routes (the Clerk webhook AND identity's PATCH /v1/users/me).
    source_timestamp timestamptz NOT NULL
);
