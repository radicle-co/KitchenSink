-- 0065 — what the cook said a copied recipe's source is: `recipes.source_kind` (ADR-0089).
--
-- `source_type = 'imported_public'` alone cannot tell a copy of a public WEB PAGE (private only, ADR-0089) from the curator's
-- public-domain text (ADR-0023, which may be public). The cook's statement ADR-0072 section 9 already names settles it:
-- `public_web`, `book` or `paid_site`. This column stores it on the recipe, in the same vocabulary the import tables use
-- (`recipe_import_items.source_kind`), so one fact has one spelling.
--
-- NULL means no statement: every recipe that exists, a recipe the cook wrote, and the curator's public-domain text. It is the
-- ONE spelling of "none". No backfill: a row that predates the column has no statement to record.
--
-- Two CHECKs. The vocabulary is closed. And every kind is paired with its label (ADR-0072 section 9): `public_web` with
-- `imported_public` AND a `source_url`, `book` with `imported_physical`, `paid_site` with `imported_paid`. So a row that
-- says "web copy" and is labelled `user_created`, or a web copy with no address, cannot be written by any writer.
--
-- Additive and expand-only (ADR-0035): one nullable column with no default, so no rewrite. Code from the previous release
-- neither reads nor writes it, and both CHECKs hold for every row it can write (all NULL).

-- ⚠️ `lock_timeout`: ALTER TABLE takes ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only its advisory lock.
--   A deploy that cannot take the table lock in 5 s fails and a re-run retries it, instead of stalling every query
--   queued behind it (`migrationLockTimeout.test.ts` holds the rule).

SET LOCAL lock_timeout = '5s';

ALTER TABLE recipes
    ADD COLUMN source_kind text,
    ADD CONSTRAINT recipes_source_kind_check CHECK (source_kind IN ('public_web', 'book', 'paid_site')),
    ADD CONSTRAINT recipes_source_kind_pairs_source_type CHECK (
        source_kind IS NULL
        OR (source_kind = 'public_web' AND source_type = 'imported_public' AND source_url IS NOT NULL)
        OR (source_kind = 'book' AND source_type = 'imported_physical')
        OR (source_kind = 'paid_site' AND source_type = 'imported_paid')
    );

COMMENT ON COLUMN recipes.source_kind IS
    'What the cook said the source is: public_web (a copy of a web page, private only), book or paid_site. NULL: no statement, including the curator''s public-domain text.';
