-- 0016_collection_source_provenance.sql (W5 Task 1) — collection pull-refresh provenance.
--
-- Foundation for W5 (collection view): three NULLABLE columns on `collections`, no default, no
-- behavioral change in this task — population happens in Task 2 (freeze source attribution at clone)
-- and Task 3 (record last_pulled_at on pull).
--
--   * last_pulled_at          — when this collection was last refreshed from its source (NULL = never
--                                pulled, including originals which are never pulled at all).
--   * source_owner_handle     — the source collection owner's display handle, frozen at clone time.
--   * source_collection_name  — the source collection's name, frozen at clone time.
--
-- All NULLABLE with no default: a pre-existing row (and every original, non-cloned collection) has none
-- of these, and the read path renders accordingly rather than fabricating provenance.
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC runner applies these in filename order; the
-- Drizzle definition in schema/collections.ts documents the shape).
-- SAFE AGAINST EXISTING ROWS: three metadata-only ADD COLUMNs.

ALTER TABLE collections
    ADD COLUMN last_pulled_at timestamptz,
    ADD COLUMN source_owner_handle text,
    ADD COLUMN source_collection_name text;
