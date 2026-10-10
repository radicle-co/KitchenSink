-- 0007: recover USDA's curated alias table into the golden record (plan U2 / KTD-2, R11)
--
-- Additive, hand-authored migration applied AFTER 0006 by the in-VPC migration runner (FU-MIGRATE) and by
-- the test harness (tests/support/db.ts applies every *.sql in lexical order). Mirrors the hand-authored
-- style of 0000-0006; the Drizzle definition in src/db/schema/food.ts documents the same column + index.
--
-- ## What is being recovered, and why it is the cheapest large win available
--
-- USDA's FNDDS dataset ships 9,648 "additional descriptions" against 5,432 main descriptions -- ~1.8 per
-- row of BRANDS, REGIONAL SYNONYMS and ALTERNATE FORMS, curated by USDA. `Cheese, Cheddar` carries
-- `Pioneer`, `New York`, `Tillamook`, `Coon`, `Longhorn`, `sharp cheese`, `Hoop`, `Wisconsin`. Every one
-- of those is a phrase a cook writes and our catalog could not previously match, and the alternative to
-- recovering them is rebuilding the same table by hand. The client discarded the field at the boundary
-- and `food` had no column for it; this migration is the column.
--
-- ⚠️ The carrier is NOT the field name KTD-2 gives. `additionalDescriptions` is a flat `;`-joined string
-- on the SEARCH envelope only. The DETAIL endpoints -- `GET /v1/food/{fdcId}` and `POST /v1/foods`, which
-- are the ones the fan-out worker persists from -- carry the same values as `foodAttributes[]` entries
-- typed `Additional Description`. Verified live against FDC on 2026-08-21 (fdcId 2705709). See
-- `additionalDescriptionsOf` in `@kitchensink/usda-client`.
--
-- ## ⛔ Why its OWN tsvector, and not folded into `search_vector`
--
-- Folding aliases into the existing generated `search_vector` means changing that column's generation
-- expression. `ALTER TABLE ... ALTER COLUMN ... SET EXPRESSION` arrived in **PostgreSQL 17**; this
-- database is 16 (the move to 18 is plan U13, deliberately last and alone). The PG 16 equivalent is
-- DROP COLUMN + ADD COLUMN, which takes an ACCESS EXCLUSIVE lock, REWRITES `food`, and drops the
-- dependent `food_search_vector_idx` with it -- a rewrite-and-reindex of the whole catalog to add a
-- column. A second STORED generated column plus its own GIN index is purely additive: existing rows get
-- `to_tsvector('english', '')` (an empty vector, which matches nothing and costs no index entries), and
-- NO existing column, index or generation expression is redefined.
--
-- `FoodSearchDao.relevanceQuery` ORs the two vectors and combines their `ts_rank` inside the SAME
-- `GREATEST` that already merges FTS relevance with trigram similarity, so the score stays ONE expression
-- and stays the sort key.
--
-- ## ⛔ Why `text` and not `text[]`
--
-- A STORED generated column requires an IMMUTABLE expression, and `array_to_string` is STABLE
-- (`pg_proc.provolatile = 's'` on 16.14) -- `GENERATED ALWAYS AS (to_tsvector('english',
-- array_to_string(aliases,' '))) STORED` fails with `generation expression is not immutable`, measured,
-- not assumed. `array_to_tsvector` IS immutable and is worse: it emits each element as a VERBATIM lexeme,
-- so a stored `Tillamook` would never match a typed `tillamook`. The list is therefore flattened onto a
-- reserved delimiter by `src/foods/foodAliases.ts`, which owns that form once.
--
-- NULL rather than `''` when a food has no aliases (GR-019: no sentinels) -- Foundation and SR Legacy
-- rows carry none, and `coalesce(...,'')` keeps the generated expression defined for them.
--
-- ## Cost, and the lock -- MEASURED, not assumed
--
-- ⚠️ `ADD COLUMN aliases text` is catalog-only (no rewrite, no default), but `ADD COLUMN ...
-- GENERATED ALWAYS AS ... STORED` **REWRITES THE TABLE** under ACCESS EXCLUSIVE -- Postgres has to
-- materialize the value for every existing row. Verified on 16.14 by `relfilenode`: unchanged across the
-- plain ADD COLUMN, changed across the generated one. Timed on a 300,000-row table of catalog-shaped text
-- carrying the same name/description/alias content and the same two GIN indexes: **~3.3s** for the
-- rewrite, ~0.1s for the alias GIN index (the alias tsvector is empty on every pre-existing row, so its
-- index starts empty and grows only as aliases are acquired).
--
-- That window is acceptable and it is NOT an argument for folding into `search_vector`, which would take
-- the SAME lock TWICE (DROP then ADD) and additionally drop `food_search_vector_idx` with the column --
-- leaving the catalog's ranked search unindexed until the recreate finished. It IS a reason the statement
-- runs where it does: ADR-0022's in-stack Trigger executes this before the new task set starts, so the
-- rewrite happens once, before traffic, rather than under it.
--
-- `CREATE INDEX` (not CONCURRENTLY) because the runner applies each file as one statement in a
-- transaction, exactly as 0001 does for `food_search_vector_idx`.
--
-- The `food_field` enum gains `aliases` so the new scalar can carry per-field provenance like every other
-- one (R5). `ALTER TYPE ... ADD VALUE` is legal inside a transaction block from PostgreSQL 12 onward
-- provided the new value is not USED in the same transaction -- verified on 16.14; nothing here uses it.
-- `food_field` is not published as a closed set on the wire (`statusResponse.provenance` is an open
-- `Record<string, string>`), so this widens no contract and moves no CONTRACT_HASH.
--
-- ⚠️ ROLLBACK: every statement here is additive and EXPAND-FIRST (ADR-0022) -- the previous release simply
-- ignores the new columns -- but an enum value CANNOT be dropped in PostgreSQL. Rolling the code back
-- leaves `food_field` carrying `aliases` with no rows referencing it, which is inert. Rolling the SCHEMA
-- back would require recreating the type, so don't: roll the code back and leave 0007 applied.
--
-- Implements: FR-008 FR-010 R11.

ALTER TABLE "food" ADD COLUMN "aliases" text;

ALTER TABLE "food"
    ADD COLUMN "aliases_search_vector" tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce("aliases", ''))
    ) STORED;

CREATE INDEX "food_aliases_search_vector_idx" ON "food" USING gin ("aliases_search_vector");

ALTER TYPE "food_field" ADD VALUE IF NOT EXISTS 'aliases';
