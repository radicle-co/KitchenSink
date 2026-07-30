-- 0013_recipe_draft_status.sql (W8-a.3 / owner decision 5) — recipe publication status (SECURITY boundary).
--
-- Adds the recipe's publication status. A `draft` is owner-only REGARDLESS of visibility (a free-tier
-- draft is visibility='public', so the visibility predicate alone would leak it): every non-owner read
-- path (search, list, community, collection-embed, clone eligibility, rating eligibility) ANDs in
-- `status = 'published' OR owner_id = :caller`, and a draft is not rateable (404, like a tombstone).
-- `status` is ORTHOGONAL to `deleted_at` (a recipe can be an active draft, a published tombstone, etc.).
--
-- Hand-authored, ordered DDL (repo convention — the in-VPC migration runner applies these in filename
-- order; the Drizzle definition in src/database/schema/recipes.ts documents the same final shape).
--
-- SAFE AGAINST EXISTING ROWS. NOT NULL with DEFAULT 'published' — the default is HONEST and load-bearing:
-- every recipe that exists today genuinely IS published (drafts are a new concept), so the column
-- backfills correctly with no data migration. The CHECK constrains the domain to draft|published.

ALTER TABLE recipes
    ADD COLUMN status text NOT NULL DEFAULT 'published'
        CONSTRAINT recipes_status_check CHECK (status IN ('draft', 'published'));
