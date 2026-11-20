-- 0091 — a cook can state a paid website as the source of a recipe (004-FR-014a, statement 5).
--
-- TWO CHECKS WIDEN BY ONE VALUE, and nothing else changes:
--   1. `recipe_statement_attestations_choice_check` (the inline CHECK of 0088) gains `paidSite`, so the act of stating a paid
--      site can be recorded next to the other statements.
--   2. `recipe_source_evidence_capture_shape` (0088) lets an `editorCitation` row be a `paid_site` as well as a `book`. The
--      citation stays required, and a web source still cannot be captured this way.
--
-- EXPAND-ONLY: both CHECKs accept every row the previous release writes, so the previous service keeps working against
-- this schema and no down migration exists. The service that writes the new values ships after this file (DD16). Narrowing
-- would be safe only while no `paidSite` attestation and no paid-site `editorCitation` row exists.

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipe_statement_attestations
    DROP CONSTRAINT recipe_statement_attestations_choice_check,
    ADD CONSTRAINT recipe_statement_attestations_choice_check
        CHECK (choice IN ('authored', 'publicWeb', 'book', 'paidSite', 'fromPerson', 'cleared', 'publicConfirm'));

ALTER TABLE recipe_source_evidence
    DROP CONSTRAINT recipe_source_evidence_capture_shape,
    ADD CONSTRAINT recipe_source_evidence_capture_shape CHECK (
        (capture <> 'editorLink' OR source_kind = 'public_web')
        AND (capture <> 'editorCitation' OR (source_kind IN ('book', 'paid_site') AND citation IS NOT NULL))
        AND (capture <> 'importFile' OR source_kind IS NOT NULL)
        AND (capture <> 'pastedPage' OR paste_digest IS NOT NULL));
