-- 0001: optional ranked full-text search over the golden record (feature 003 — T-180, FR-008/FR-010)
--
-- Additive, hand-authored migration applied AFTER 0000 by the in-VPC migration runner (FU-MIGRATE)
-- and by the test harness (tests/support/db.ts + schema.integration.test.ts apply every *.sql in
-- lexical order, so 0000 then 0001). Mirrors the 0000 hand-authored style; the Drizzle definition in
-- src/db/schema/food.ts documents the same column/index.
--
-- Adds a STORED generated `tsvector` over name + description and a GIN index for ranked FTS (ts_rank).
-- This is the "optional ranked FTS" note in plan.md §2: pg_trgm (food_name_trgm_idx /
-- food_description_trgm_idx, from 0000) REMAINS the fuzzy/substring/typo fallback; FTS adds lexeme
-- matching (word-order-independent) + relevance ranking on top. No table is added (still 13 tables).
--
-- The generated expression uses the TWO-ARG to_tsvector('english', …) form with a constant regconfig,
-- which is IMMUTABLE (a STORED generated column requires an immutable expression). coalesce(...,'')
-- keeps the vector defined when name/description are NULL.
-- Implements: FR-008 FR-010.

ALTER TABLE "food"
    ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce("name", '') || ' ' || coalesce("description", ''))
    ) STORED;

CREATE INDEX "food_search_vector_idx" ON "food" USING gin ("search_vector");
