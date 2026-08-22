/**
 * The LOCAL Scoring Policy (plan U5, R1–R5) — the one authoritative definition of how recipe-service's own
 * `ingredients` rows are ordered for a text query, rendered as the SQL that `IngredientsDal.search` sorts on.
 *
 * DESIGN PATTERN: **Policy module + Builder**, the sibling of food-service's
 * `foods/dao/foodRelevance.ts`. The *rule* — which rungs exist, what each means, how a rung and a base
 * metric combine into a score — lives once, purely, in `@kitchensink/recipe-core/resolution/ranking-tiers`.
 * This module renders that rule for THIS surface: its own name column, its own base metric, and U6's `raw`
 * affinity.
 *
 * ## ⛔ The two files are deliberate duplicates, and the duplication is bounded
 *
 * The plan's rule for U5 is "shared rule, never shared SQL". The alternative — a shared SQL builder — would
 * have to live in a package both services import, which today means `@kitchensink/recipe-core`; that package
 * is also imported by the web and mobile feature packages, so it would pull `drizzle-orm` into a mobile
 * bundle to serve two backend statements. What is shared is the VOCABULARY (`rankingTerms.ts`) and the
 * LADDER (`rankingTiers.ts`) — the knowledge. What is duplicated is the rendering of it into two different
 * dialects of one query language, over two different tables and two different metrics.
 *
 * The guard against drift is not review: it is
 * `@kitchensink/service-test-harness`'s `registerRankingConformance`, which BOTH services run against their
 * own DAL and a real database, and which fails on either side if a rule changes and only one mirror follows.
 *
 * ## The defect on THIS surface is a TIE, not a penalty
 *
 * Measured on `postgres:16` with `pg_trgm`, 2026-08-22:
 *
 * | expression                                | value |
 * | ----------------------------------------- | ----- |
 * | `word_similarity('flour', 'Flour')`       | 1.00  |
 * | `word_similarity('flour', 'Carob flour')` | 1.00  |
 *
 * `word_similarity` measures the best matching word EXTENT, so it does not penalise extra words and both
 * rows score the maximum. `name ASC` then decides, and `'Carob flour' < 'Flour'`: the attractor wins by the
 * alphabet. This surface decided **92.8%** of the import's lines, which is why the plan's corrected Problem
 * frame calls it the likely whole story.
 *
 * ⛔ The base metric still has to be `word_similarity`. KTD-1's `flor` → `All-purpose flour` case scores
 * 0.600 by word similarity and only 0.15 by `similarity` — below the `%` operator's 0.3 threshold, so
 * swapping metrics would not merely re-rank that row, it would stop RETRIEVING it. The ladder goes above the
 * metric; the metric stays.
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { RankingTerms } from '@kitchensink/recipe-core/resolution/ranking-terms';
import {
    BASE_METRIC_MAX,
    RAW_AFFINITY_BONUS,
    SCORE_CEILING,
    TIER_GAP,
} from '@kitchensink/recipe-core/resolution/ranking-tiers';

import type { IngredientMatchStrategy } from '../selectIngredientMatchStrategy.js';

/**
 * The lateral alias the per-row ranking terms are computed under.
 *
 * ⚠️ Written LITERALLY in the fragments below rather than interpolated — `sql.raw` is banned in this
 * repository (it splices its argument into the statement text) and an identifier cannot be a bound
 * parameter. `__tests__/ingredientRelevance.test.ts` asserts that both fragments contain this constant.
 */
export const LOCAL_RANK_TERMS_ALIAS = 'rank_terms';

/**
 * The regex literals the fold and the tokenizer use, mirroring `rankingTerms.ts` character for character —
 * and, necessarily, food-service's `foodRelevance.ts` too. They travel as BOUND PARAMETERS.
 */
const REGEX = {
    /** Unicode combining marks — what NFD splits an accented letter into. */
    combiningMarks: '[\\u0300-\\u036f]',
    /**
     * Whitespace, as the SAME explicit ASCII class `rankingTerms.ts` uses.
     *
     * ⛔ NOT `[[:space:]]`, which disagrees with JavaScript's `\s` on NBSP.
     */
    asciiWhitespace: String.raw`[ \t\n\r\f\v]+`,
    /** Every run that is not a letter or a digit — the token separator. */
    tokenSeparator: String.raw`[^[:alnum:]]+`,
    /** A sibilant stem that takes `-es` in the plural. */
    esPlural: String.raw`(s|x|z|ch|sh)es$`,
    /** A plain `-s` plural whose preceding character is not itself an `s`. */
    sPlural: String.raw`[^s]s$`,
} as const;

/** Minimum token length before the `-es` arm of the plural rule may fire — mirrors `rankingTerms.ts`. */
const ES_PLURAL_MIN_LENGTH = 5;

/** Minimum token length before the `-s` arm of the plural rule may fire — mirrors `rankingTerms.ts`. */
const S_PLURAL_MIN_LENGTH = 4;

/** The token a `raw` affinity looks for in a row's tokens. Already singular, so the plural rule is a no-op. */
const RAW_TOKEN = 'raw';

/** A tiered sort key: the lateral that computes a row's terms, and the score expression over it. */
export interface LocalTieredSortKey {
    /** The `CROSS JOIN LATERAL … AS rank_terms` clause the statement MUST include. */
    readonly lateral: SQL;
    /** The score expression, which is ALSO the sort key. */
    readonly score: SQL;
}

/**
 * The SQL mirror of `foldForRanking` over `ingredients.name`.
 *
 * @returns The folded-name expression. Pure.
 */
function foldedNameSql(): SQL {
    return sql`btrim(regexp_replace(
        regexp_replace(normalize(lower(ingredients.name), NFD), ${REGEX.combiningMarks}, '', 'g'),
        ${REGEX.asciiWhitespace}, ' ', 'g'
    ), ' ')`;
}

/**
 * The SQL mirror of `rankingTokens`.
 *
 * ⚠️ `WITH ORDINALITY` + `ORDER BY` is load-bearing: the head rung reads `tokens[1]`, and a set-returning
 * function's output order is not guaranteed by the standard.
 *
 * @returns A `text[]` expression of folded, singularized tokens, in source order. Pure.
 */
function rankingTokensSql(): SQL {
    return sql`ARRAY(
        SELECT CASE
                   WHEN length(split.token) >= ${ES_PLURAL_MIN_LENGTH}::int
                        AND split.token ~ ${REGEX.esPlural} THEN left(split.token, -2)
                   WHEN length(split.token) >= ${S_PLURAL_MIN_LENGTH}::int
                        AND split.token ~ ${REGEX.sPlural} THEN left(split.token, -1)
                   ELSE split.token
               END
        FROM regexp_split_to_table(folded_name.value, ${REGEX.tokenSeparator})
             WITH ORDINALITY AS split(token, position)
        WHERE split.token <> ''
        ORDER BY split.position
    )`;
}

/**
 * The tier expression: a `CASE` whose branches are the ladder, highest rung first. The `base` rung is the
 * `ELSE`, which is what makes the ladder TOTAL.
 *
 * @param terms - The query's terms, pre-computed by the match strategy.
 * @returns An integer expression in `[0, RANK_TIERS.length - 1]`. Pure.
 */
function rankTierSql(terms: RankingTerms): SQL {
    // ⛔ `sql.param(...)`, NOT a bare `${array}`. Drizzle flattens a plain array interpolation into one
    // placeholder per element, so `${tokens}::text[]` renders as `($1, $2)::text[]` — a ROW constructor cast
    // to an array, which is a different expression that happens to parse.
    const queryTokens = sql`${sql.param([...terms.tokens])}::text[]`;

    return sql`(CASE
        WHEN rank_terms.folded = ${terms.folded} THEN 4
        WHEN rank_terms.tokens <@ ${queryTokens} AND ${queryTokens} <@ rank_terms.tokens THEN 3
        WHEN rank_terms.tokens[1] = ${terms.head ?? null} THEN 2
        WHEN ${queryTokens} <@ rank_terms.tokens THEN 1
        ELSE 0
    END)`;
}

/**
 * The `raw` affinity term (plan U6), or nothing at all.
 *
 * ⚠️ When the strategy did not inject `raw` this contributes NO SQL, rather than a `+ 0`. An inert term
 * would still put the word `raw` into a statement that has nothing to do with it, and the next reader would
 * have to work out that it does nothing.
 *
 * @param strategy - The chosen match strategy.
 * @returns The bonus expression, or `undefined`. Pure.
 */
function rawAffinitySql(strategy: IngredientMatchStrategy): SQL | undefined {
    if (strategy.kind === 'none' || !strategy.rawAffinity) {
        return undefined;
    }

    return sql` + (CASE WHEN ${RAW_TOKEN} = ANY(rank_terms.tokens) THEN ${RAW_AFFINITY_BONUS}::float8 ELSE 0::float8 END)`;
}

/**
 * Build the local table's tiered sort key for one match strategy.
 *
 * @param strategy - The chosen match strategy, carrying the query's pre-parsed terms (never `none` — the
 *   DAL short-circuits that before it needs a sort key).
 * @param baseMetric - This statement's base metric expression (`word_similarity(query, name)`).
 * @returns The lateral to join, and the score to order by. Pure.
 */
export function localTieredSortKey(
    strategy: Exclude<IngredientMatchStrategy, { kind: 'none' }>,
    baseMetric: SQL,
): LocalTieredSortKey {
    const rawAffinity = rawAffinitySql(strategy);

    return {
        lateral: sql`CROSS JOIN LATERAL (
            SELECT folded_name.value AS folded, ${rankingTokensSql()} AS tokens
            FROM (SELECT ${foldedNameSql()}) AS folded_name(value)
        ) AS rank_terms`,
        score: sql`((${TIER_GAP}::float8 * ${rankTierSql(strategy.terms)}::float8
            + LEAST(GREATEST(${baseMetric}, 0::float8), ${BASE_METRIC_MAX}::float8)${rawAffinity ?? sql``}
        ) / ${SCORE_CEILING}::float8)::float8`,
    };
}
