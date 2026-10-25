-- 0026 — `food.rank_alias_keys`: the comparison key of each curated synonym, for the `synonym` rung (ADR-0070).
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/food.ts documents the same expression (`food.rankAliasKeys`).
--
-- ── Why a rung needs its own column ─────────────────────────────────────────────────────────────
--   A root's synonyms sit in `food.aliases`, joined by `; ` (`ALIAS_DELIMITER`, foodAliases.ts). Until now they fed
--   only the base metric, through `ts_rank(aliases_search_vector)`, so a synonym could never lift its root above
--   another head-rung row: `granulated sugar` reached `Sugars, granulated` (token set) before the root `sugar` that
--   lists it. The `synonym` rung holds when the query's comparison key equals one of these keys.
--
-- ── The key ─────────────────────────────────────────────────────────────────────────────────────
--   `rankingKeyOf()` in recipe-core: the synonym's folded, singularized tokens joined by one space, which is
--   `rank_tokens_of()` (0011) joined the same way. Empty keys are dropped, and a root with no synonyms holds an
--   empty array, never NULL, so `= ANY(...)` is simply false for it.
--
-- STORED, like every ranking column: a sort-key input read on every search. No index: never a predicate.

CREATE FUNCTION rank_alias_keys_of(aliases text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (
    SELECT coalesce(array_agg(key ORDER BY position) FILTER (WHERE key <> ''), '{}'::text[])
    FROM (
        SELECT array_to_string(rank_tokens_of(alias), ' ') AS key, position
        FROM unnest(string_to_array(aliases, '; ')) WITH ORDINALITY AS split(alias, position)
    ) AS keyed
);

COMMENT ON FUNCTION rank_alias_keys_of(text) IS
    'ADR-0070 ranking helper: rankingKeyOf() of each synonym in food.aliases, in order, empty keys dropped. '
    'IMMUTABLE so the generated column may call it. Never CREATE OR REPLACE it: add a new function and SET EXPRESSION.';

ALTER TABLE food ADD COLUMN rank_alias_keys text[] GENERATED ALWAYS AS (rank_alias_keys_of(aliases)) STORED;

COMMENT ON COLUMN food.rank_alias_keys IS
    'ADR-0070 ranking term: the synonym keys the synonym rung compares the query key with. Sort key, never a predicate.';
