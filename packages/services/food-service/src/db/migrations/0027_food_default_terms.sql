-- 0027 — `food.default_terms` and `food.rank_default_keys`: a bare noun's curated default, for the `default` rung
-- (ADR-0070 §4).
--
-- Hand-authored, ordered DDL applied once by the migration runner, which wraps this file in one transaction.
-- The Drizzle model in src/db/schema/food.ts documents the same columns (`food.defaultTerms`, `food.rankDefaultKeys`).
--
-- ── Why a default is its own column, and not a synonym ──────────────────────────────────────────
--   The owner ruled bare-noun defaults on 2026-10-25 (milk → whole milk, flour → all-purpose flour, nutmeg → ground
--   nutmeg, and others; curatedCatalog.jsonl holds the list). A synonym in `food.aliases` is the food itself:
--   catalog-name identity (`catalogNameMatch.ts`) answers a synonym with its root, with no cook involved, so a synonym
--   `milk` would bind whole milk outright. A default term only lists its root first for that noun, and the UI labels
--   it and never selects it. So it lives in a column catalog-name identity never reads.
--
-- ── default_terms: seed-owned content ───────────────────────────────────────────────────────────
--   The seed writes it from `defaultFor` in curatedCatalog.jsonl, in seed order, and the verifier compares it. Every
--   other row holds an empty array, never NULL (GR-019), so a writer that does not name the column needs no change.
--
-- ── rank_default_keys: the comparison key of each term ──────────────────────────────────────────
--   `rankingKeyOf()` in recipe-core, as `describeCatalogName().defaultKeys` applies it: each term's folded,
--   singularized tokens (`rank_tokens_of()`, 0011) joined by one space, empty keys dropped, order kept. The `default`
--   rung holds when the query's key equals one of them. STORED, like every ranking column: a sort-key input read on
--   every search. No index: never a predicate.
--
-- ⚠️ `rank_default_keys_of` is declared IMMUTABLE and calls `array_to_string`, which pg_proc marks STABLE. It is
--   safe for the reason 0026 gives: the array is `rank_tokens_of()`'s text[], and text output reads no setting.
--
-- ⚠️ `lock_timeout`: this file rewrites `food` under ACCESS EXCLUSIVE, and the runner's own lock_timeout covers only
--   its advisory lock. A deploy that cannot take the table lock in 5 s fails, and a re-run retries it, instead of
--   stalling every food read queued behind it.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION rank_default_keys_of(terms text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (
    SELECT coalesce(array_agg(key ORDER BY position) FILTER (WHERE key <> ''), '{}'::text[])
    FROM (
        SELECT array_to_string(rank_tokens_of(term), ' ') AS key, position
        FROM unnest(terms) WITH ORDINALITY AS split(term, position)
    ) AS keyed
);

COMMENT ON FUNCTION rank_default_keys_of(text[]) IS
    'ADR-0070 ranking helper: rankingKeyOf() of each default term, in order, empty keys dropped. '
    'IMMUTABLE so the generated column may call it. Never CREATE OR REPLACE it: add a new function and SET EXPRESSION.';

ALTER TABLE food ADD COLUMN default_terms text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN food.default_terms IS
    'ADR-0070: the bare nouns this seed root is the curated default for (curatedCatalog.jsonl defaultFor), in seed '
    'order. Not a synonym: catalog-name identity never reads it. Empty for every other row.';

ALTER TABLE food ADD COLUMN rank_default_keys text[]
    GENERATED ALWAYS AS (rank_default_keys_of(default_terms)) STORED;

COMMENT ON COLUMN food.rank_default_keys IS
    'ADR-0070 ranking term: the default keys the default rung compares the query key with. '
    'Sort key, never a predicate.';
