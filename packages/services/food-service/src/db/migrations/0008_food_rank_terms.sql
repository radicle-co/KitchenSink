-- 0008: materialize the ranking terms the U5 tier ladder sorts on (plan U5, R1-R5)
--
-- Additive, hand-authored migration applied AFTER 0007 by the in-VPC migration runner (FU-MIGRATE) and by
-- the test harness (tests/support/db.ts applies every *.sql in lexical order). Mirrors 0007's shape: two
-- STORED generated columns, no index, no change to any existing column.
--
-- ## ⛔ WHY THIS EXISTS: the ladder is unaffordable computed per row, and that was MEASURED
--
-- U5 orders `food` by a tier ladder above `similarity` (see `foods/dao/foodRelevance.ts`). The ladder needs
-- three things per candidate row: the folded name, its token array, and its head term. Computing them inside
-- the statement means a `normalize(..., NFD)`, two `regexp_replace`s and a tokenizer for EVERY row the
-- predicate matched -- and the predicate matches thousands (the SC-007 `broad` shape matches 3,847 of
-- 50,000; `brand` matches 7,143).
--
-- Measured on a 50,000-row production-shaped store, 2026-08-22, p95 over 20 runs, statement-level:
--
--   shape   rows   pre-U5   computed per row   MATERIALIZED (this migration)
--   broad   3847    14.8ms            253.0ms                        15.6ms
--   brand   7143    23.6ms            356.7ms                        28.8ms
--   phrase  1156    15.1ms             54.0ms                        17.8ms
--
-- SC-007's budget is 200ms p95 at 50,000 foods, and this workstation measures the search statement several
-- times faster than CI. The per-row form is not a slow implementation of the ladder; it is a different
-- feature. Materialized, the whole ladder costs +0.8 to +5.2ms.
--
-- ## What the expressions are, and why they are shaped the way they are
--
-- They are the SQL mirror of `foldForRanking` and `rankingTokens` in
-- `@kitchensink/recipe-core/resolution/ranking-terms`, character for character. Three constraints shaped
-- them, and all three are load-bearing:
--
--  1. **A generated-column expression may not contain a subquery.** So the plural rule is applied to the
--     whole folded STRING with two global `regexp_replace`s, not per token with `regexp_split_to_table` +
--     `ARRAY(...)`. `rankingTerms.ts` uses exactly the same two patterns for exactly this reason.
--  2. **A generated-column expression must be IMMUTABLE.** `lower`, `normalize`, `regexp_replace`,
--     `btrim`, `regexp_split_to_array` and `array_remove` all are.
--  3. **The two engines' regex dialects must agree.** Hence `[\u0300-\u036f]` as an ARE escape rather than
--     the `unaccent` extension (whose rules file is not NFD and could not be mirrored in TypeScript); an
--     explicit ASCII whitespace class rather than `[[:space:]]` (which disagrees with JavaScript's `\s` on
--     NBSP); and `(?!s)[[:alnum:]]` rather than `[^s]` in the `-s` arm, because `[^s]` also matches a SPACE
--     and would let one word eat the next.
--
-- `array_remove(..., '')` drops the empty element `regexp_split_to_array` yields for a name that starts or
-- ends in punctuation (`'Flour,'`). Without it such a row could never reach the token-set rung, because the
-- empty string is not in any query's token array.
--
-- ## ⚠️ Deploy note: this REWRITES `food` under ACCESS EXCLUSIVE
--
-- `ADD COLUMN ... GENERATED ALWAYS AS ... STORED` computes the value for every existing row, so the table is
-- rewritten and the lock is held for the duration -- the same cost 0007 paid for `aliases_search_vector`.
-- Per ADR-0022 this runs inside the deploy, ahead of the service that reads it, so the window is the
-- migration's and not a period of schema skew. It is purely EXPAND: nothing reads these columns until the
-- image that ships with them starts, and nothing writes them ever (Postgres computes them), so a rollback to
-- the previous image leaves them harmlessly present.
--
-- No index is added. These columns are a SORT KEY, never a predicate; the trigram and FTS indexes the
-- statement's `WHERE` uses are untouched, and U5's brief is explicit that they are load-bearing and must not
-- be changed.

ALTER TABLE food
    ADD COLUMN rank_folded text GENERATED ALWAYS AS (
        btrim(
            regexp_replace(
                regexp_replace(normalize(lower(name), NFD), '[\u0300-\u036f]', '', 'g'),
                '[ \t\n\r\f\v]+', ' ', 'g'
            ),
            ' '
        )
    ) STORED,
    ADD COLUMN rank_tokens text[] GENERATED ALWAYS AS (
        array_remove(
            regexp_split_to_array(
                regexp_replace(
                    regexp_replace(
                        btrim(
                            regexp_replace(
                                regexp_replace(normalize(lower(name), NFD), '[\u0300-\u036f]', '', 'g'),
                                '[ \t\n\r\f\v]+', ' ', 'g'
                            ),
                            ' '
                        ),
                        '([[:alnum:]]{2}(s|x|z|ch|sh))es(?![[:alnum:]])', '\1', 'g'
                    ),
                    '([[:alnum:]]{2}(?!s)[[:alnum:]])s(?![[:alnum:]])', '\1', 'g'
                ),
                '[^[:alnum:]]+'
            ),
            ''
        )
    ) STORED;

COMMENT ON COLUMN food.rank_folded IS
    'U5 ranking term: the SQL mirror of foldForRanking(name). Sort key input only, never a predicate.';
COMMENT ON COLUMN food.rank_tokens IS
    'U5 ranking terms: the SQL mirror of rankingTokens(name), in source order. rank_tokens[1] is the head term.';
