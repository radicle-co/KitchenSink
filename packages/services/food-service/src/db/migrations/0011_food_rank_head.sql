-- 0011 — `food.rank_head`: the SQL mirror of `describeRankingName(name).head` (plan U1, D4b).
--
-- ⛔ WHY `rank_tokens[1]` STOPPED BEING THE HEAD. SR Legacy holds two naming grammars: the inverted
-- convention (`Flour, wheat, all-purpose` — head noun FIRST) that 0008's comment assumed universal, and
-- NATURAL-ORDER product names whose first comma segment is an English noun phrase (`Cinnamon buns,
-- frosted` — head noun LAST within the segment). The first-token rule crowned the MODIFIER of the second
-- class: measured 2026-08-29, `Cinnamon buns, frosted` won the bare query `cinnamon` at the head rung
-- with a WIDE margin — a false catch that would have skipped verification (the plan's Problem Frame calls
-- this the business-critical class). The rule, identical to the TypeScript side:
--
--   comma present AND first segment multi-word  ->  LAST token of the first segment
--   otherwise                                   ->  first token of the whole name
--
-- ⚠️ A NO-COMMA name keeps its first token DELIBERATELY: flipping `Carob flour` to a last-word head would
-- promote the attractor INTO the head rung for the query `flour` — the defect the head asymmetry ended.
--
-- ⚠️ The helper function repeats 0008's fold -> singularize -> split pipeline VERBATIM (same regexes, same
-- order) because a generated column cannot reference another generated column, and the two expressions
-- MUST stay byte-equivalent or the stored tokens and the stored head drift apart. It is IMMUTABLE — every
-- function it calls is immutable — which is what lets a GENERATED column use it.
--
-- STORED, like 0008's columns: this is a sort-key input read on every search; computing it per row per
-- query is the cost the stored columns exist to avoid (SC-007's 250ms budget). No index: sort key, never
-- a predicate.

CREATE FUNCTION rank_tokens_of(source text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN array_remove(
    regexp_split_to_array(
        regexp_replace(
            regexp_replace(
                btrim(
                    regexp_replace(
                        regexp_replace(normalize(lower(source), NFD), '[̀-ͯ]', '', 'g'),
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
);

COMMENT ON FUNCTION rank_tokens_of(text) IS
    'U1 ranking helper: the SQL mirror of rankingTokens(), byte-equivalent to 0008''s inline pipeline. '
    'IMMUTABLE so generated columns may call it. Change it and 0008''s columns together or not at all.';

ALTER TABLE food
    ADD COLUMN rank_head text GENERATED ALWAYS AS (
        CASE
            WHEN position(',' in name) > 0
                AND cardinality(rank_tokens_of(split_part(name, ',', 1))) > 1
            THEN (rank_tokens_of(split_part(name, ',', 1)))[
                cardinality(rank_tokens_of(split_part(name, ',', 1)))
            ]
            ELSE (rank_tokens_of(name))[1]
        END
    ) STORED;

COMMENT ON COLUMN food.rank_head IS
    'U1 ranking term: the SQL mirror of describeRankingName(name).head — last token of a multi-word first '
    'comma segment, else the first token. Supersedes rank_tokens[1] as the head; sort key, never a predicate.';
