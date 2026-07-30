-- 0011_photo_thumbnail_key.sql (FOLLOW-UP-CR-001-A) — recipe-photo cover thumbnail rendition.
--
-- Adds the object key of a photo's small cover-thumbnail rendition, generated synchronously on confirm
-- and stored BESIDE the full-size original under the same owner erasure prefix (ARCH-BE-3). The recipe
-- LIST / SEARCH cover LATERALs serve COALESCE(thumbnail_key, s3_key), so a ~300px card tile no longer
-- ships the up-to-5 MB original (SC-009 / mobile-data cost).
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/photos.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. The column is NULLABLE with no default: a metadata-only ADD COLUMN (no
-- table rewrite, no backfill). Existing photos keep thumbnail_key = NULL and the cover projections fall
-- back to the full-size original for them, so nothing is orphaned and no rendition is required to exist.

ALTER TABLE recipe_photos ADD COLUMN thumbnail_key text;
