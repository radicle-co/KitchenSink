-- 0025 — `food.rank_head` reads the ENGLISH HEAD NOUN of a name (ADR-0070): the SQL mirror of `rankingHeadOf()`.
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/food.ts documents the same expression (`food.rankHead`).
--
-- ── Why 0011's rule had to go ───────────────────────────────────────────────────────────────────
--   0011 took the FIRST token of a comma-free name, because SR Legacy wrote inverted names (`Flour, wheat`), and it
--   used that first token to keep `Carob flour` out of the head rung for `flour`. The curated seed (ADR-0051) then
--   renamed 2,640 of its 2,642 roots into natural English, where the head noun is LAST. The first-token rule crowned
--   their modifiers: on 2026-10-25 a prod paste import bound `milk` to milk crackers, `salt` to salt cod, `cinnamon`
--   to cinnamon rolls and `bread` to bread flour, each reported RESOLVED. A default meaning is now a seed default, so
--   the head rule tells the truth.
--
-- ── The rule, identical to the TypeScript side ──────────────────────────────────────────────────
--   1. remove each bracketed group          `Tamales (Navajo)`           -> `Tamales`
--   2. cut a trailing standalone `in …`      `walnuts in syrup`           -> `walnuts`
--   3. take the LAST token of the text before the first comma
--        `Flour, wheat` -> flour     `Cinnamon buns, frosted` -> bun     `milk crackers` -> cracker
--   4. if that segment holds no token, the reduced whole text answers, then the original name.
--
-- ⚠️ `rank_head_of` is a NEW function, not a replacement of 0011's column body by `CREATE OR REPLACE`: a STORED
-- generated column is computed when a row is written, so replacing a function it calls leaves every existing row
-- holding the old answer. `SET EXPRESSION` (PostgreSQL 17+; every stage runs 18) rewrites the table and recomputes
-- every row. If this rule changes again, add another function and another `SET EXPRESSION`.
--
-- ⚠️ The whitespace class is the explicit ASCII one and the regexes avoid every construct the two engines read
-- differently, for the reason `rankingTerms.ts` gives. `tests/e2e/rankingTerms.e2e.test.ts` compares the stored
-- value with `describeRankingName().head` name by name.
--
-- No index: a sort-key input, never a predicate.

CREATE FUNCTION rank_head_of(source text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (
    SELECT COALESCE(
        segment_tokens[cardinality(segment_tokens)],
        reduced_tokens[cardinality(reduced_tokens)],
        source_tokens[cardinality(source_tokens)]
    )
    FROM (
        SELECT
            rank_tokens_of(split_part(reduced, ',', 1)) AS segment_tokens,
            rank_tokens_of(reduced) AS reduced_tokens,
            rank_tokens_of(source) AS source_tokens
        FROM (
            SELECT regexp_replace(
                regexp_replace(source, '\([^)]*\)', ' ', 'g'),
                '[ \t\n\r\f\v]in[ \t\n\r\f\v].*$', '', 'i'
            ) AS reduced
        ) AS stripped
    ) AS tokenized
);

COMMENT ON FUNCTION rank_head_of(text) IS
    'ADR-0070 ranking helper: the SQL mirror of rankingHeadOf(), the English head noun of the first comma segment. '
    'IMMUTABLE so the generated column may call it. Never CREATE OR REPLACE it: add a new function and SET EXPRESSION.';

ALTER TABLE food ALTER COLUMN rank_head SET EXPRESSION AS (rank_head_of(name));

COMMENT ON COLUMN food.rank_head IS
    'ADR-0070 ranking term: rank_head_of(name), the SQL mirror of describeRankingName(name).head. '
    'Sort key, never a predicate.';
