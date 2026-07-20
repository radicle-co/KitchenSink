-- 0014_version_device_label.sql (W8-a.6 / FR-007b) — device attribution on version history.
--
-- Adds the device that authored a recipe version, captured as bounded free text from the write request
-- (create/update). Rendered in the W6 version-history attribution AND the W7 conflict banner via the
-- normal escaping/localization path (user-controlled text — never dangerouslySetInnerHTML).
--
-- A mutable COLUMN, deliberately NOT a field inside the immutable `snapshot` JSONB — consistent with
-- `created_by`/`change_summary` living as columns, and (like editor_handle in W8-a.2) kept reachable
-- rather than frozen inside a snapshot that is never rewritten.
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/versions.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. NULLABLE with no default (same reasoning as CR-001's difficulty): a device
-- is not knowable retroactively, so a default would fabricate attribution on every historical version.
-- Existing rows keep device_label = NULL and the UI renders "unknown device" / omits it.

ALTER TABLE recipe_versions ADD COLUMN device_label text;
