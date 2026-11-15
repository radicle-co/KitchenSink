-- 0080 — a bulk-import snapshot line can be counted once for curation review (ADR-0072 §4; review item 5 on #220).
--
-- One pipeline (owner ruling 2026-11-11): a curated mapping the review gate contradicts is counted for curation review
-- whether the cook sees it in a paste or in an import. The paste counts it once per row and verdict through
-- `recipe_parse_job_matches.curation_reported_at` (0057). The import's snapshot line is its own row, so it carries its own
-- marker, with the same meaning:
--
--  - `curation_reported_at`: when the contradiction of this line's curated proposal was counted. NULL until a read wins the
--    claim (`UPDATE … WHERE curation_reported_at IS NULL`), so a poll loop counts it once. Only a CURATED line with a
--    verdict key can carry it, the same rule the paste's row holds.
--
-- Additive and expand-only (ADR-0035): one nullable column, no default. The CHECK is added NOT VALID: it binds every write
-- at once, and 0081 scans the existing rows under a lighter lock. No GRANT: the service role's DML on this table comes from
-- 0059 (ADR-0039).

-- ⚠️ Bounded wait: ALTER TABLE takes ACCESS EXCLUSIVE on the table. A deploy that cannot take it in 5 s fails and a re-run
-- retries it (`migrationLockTimeout.test.ts` holds the rule).
SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_import_lines
    ADD COLUMN curation_reported_at timestamptz;

ALTER TABLE recipe_import_lines
    ADD CONSTRAINT recipe_import_lines_curation_reported_check
        CHECK (curation_reported_at IS NULL OR (matched_by = 'curated' AND verification_key IS NOT NULL)) NOT VALID;
