/**
 * The LOCAL Scoring Policy (plan U5, R1–R5) — the one authoritative definition of how recipe-service's own
 * `ingredients` rows are ordered for a text query, rendered as the SQL that `IngredientsDal.search` sorts on.
 *
 * DESIGN PATTERN: **Policy module + Builder**, the sibling of food-service's `foods/dao/foodRelevance.ts`.
 * The *rule* — which rungs exist, what each means, how a rung and a base metric combine into a score — lives
 * once, purely, in `@kitchensink/recipe-core/resolution/ranking-tiers`. This module renders that rule for
 * THIS surface: its own materialized ranking columns, its own base metric, and U6's `raw` affinity.
 *
 * ## ⛔ The ranking terms are MATERIALIZED, and that was forced by measurement
 *
 * The fold, the tokenizer and the plural rule are not in this file. They live in migration
 * `0024_ingredient_rank_terms.sql` as two STORED generated columns, because computing them per row is
 * unaffordable. Measured on food-service's identically-shaped statement over 50,000 production-shaped rows
 * (2026-08-22, p95 over 20 runs), the per-row form cost **253ms** on the `broad` shape and **357ms** on
 * `brand`, against SC-007's 200ms budget and a pre-U5 baseline of 15ms and 24ms. Materialized, the whole
 * ladder costs **+0.8ms** and **+5.2ms**.
 *
 * That constraint also shaped the RULE, not only its storage: a generated-column expression may not contain
 * a subquery, so the plural fold is applied to whole text with two global `regexp_replace`s rather than per
 * token — which is why `rankingTerms.ts` defines `singularizeRankingText` and derives the per-token form
 * from it rather than the other way round.
 *
 * ## ⛔ The two policy files are deliberate duplicates, and the duplication is bounded
 *
 * The plan's rule for U5 is "shared rule, never shared SQL". The alternative — a shared SQL builder — would
 * have to live in a package both services import, which today means `@kitchensink/recipe-core`; that package
 * is also imported by the web and mobile feature packages, so it would pull `drizzle-orm` into a mobile
 * bundle to serve two backend statements. What is shared is the VOCABULARY (`rankingTerms.ts`) and the
 * LADDER (`rankingTiers.ts`) — the knowledge. What is duplicated is the rendering of it into two dialects of
 * one query language, over two tables and two metrics.
 *
 * Two guards stand against drift, not review:
 * `__tests__/integration/ingredients/rankingTerms.integration.test.ts` asserts every materialized column
 * value equals the TypeScript reference row by row, and `@kitchensink/service-test-harness`'s
 * `registerRankingConformance` asserts the resulting ORDER on both surfaces. A rule that changes and reaches
 * only one mirror fails on the other.
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

/** The token a `raw` affinity looks for in a row's tokens. Already singular, so the plural rule is a no-op. */
const RAW_TOKEN = 'raw';

/**
 * The columns migration `0024_ingredient_rank_terms.sql` materializes: the SQL mirror of
 * `foldForRanking(name)` and `rankingTokens(name)`, computed once on write by Postgres. Exported so the unit
 * test can assert the statement NAMES them rather than folding per row — the regression that guards against
 * is a performance cliff, not a wrong answer, and it would pass every ordering test in the repository.
 */
export const LOCAL_RANK_TERM_COLUMNS = ['ingredients.rank_folded', 'ingredients.rank_tokens'] as const;

/**
 * The tier expression: a `CASE` whose branches are the ladder, highest rung first, so the first branch that
 * holds is the highest rung that holds. The `base` rung is the `ELSE`, which is what makes the ladder TOTAL.
 *
 * ⚠️ A query with no tokens never reaches here — `selectIngredientMatchStrategy` routes it to `none` and the
 * DAL short-circuits without a round trip. That matters, because `'{}' <@ anything` is TRUE: an empty query
 * would otherwise be promoted to `covered` by a vacuous comparison.
 *
 * @param terms - The query's terms, pre-computed by the match strategy.
 * @returns An integer expression in `[0, RANK_TIERS.length - 1]`. Pure.
 */
function rankTierSql(terms: RankingTerms): SQL {
    // ⛔ `sql.param(...)`, NOT a bare `${array}`. Drizzle FLATTENS a plain array interpolation into one
    // placeholder per element, so `${tokens}::text[]` renders as `($1, $2)::text[]` — a ROW constructor cast
    // to an array, which is a different expression that happens to parse.
    const queryTokens = sql`${sql.param([...terms.tokens])}::text[]`;

    return sql`(CASE
        WHEN ingredients.rank_folded = ${terms.folded} THEN 4
        WHEN ingredients.rank_tokens <@ ${queryTokens} AND ${queryTokens} <@ ingredients.rank_tokens THEN 3
        WHEN ingredients.rank_tokens[1] = ${terms.head ?? null} THEN 2
        WHEN ${queryTokens} <@ ingredients.rank_tokens THEN 1
        ELSE 0
    END)`;
}

/**
 * The `raw` affinity term (plan U6), or nothing at all.
 *
 * ⚠️ When the strategy did not inject `raw` this contributes NO SQL, rather than a `+ 0`. An inert term
 * would still put a `raw` comparison into a statement that has nothing to do with it, and the next reader
 * would have to work out that it does nothing.
 *
 * @param strategy - The chosen match strategy.
 * @returns The bonus expression, or `undefined`. Pure.
 */
function rawAffinitySql(strategy: IngredientMatchStrategy): SQL | undefined {
    if (strategy.kind === 'none' || !strategy.rawAffinity) {
        return undefined;
    }

    return sql` + (CASE WHEN ${RAW_TOKEN} = ANY(ingredients.rank_tokens)
        THEN ${RAW_AFFINITY_BONUS}::float8 ELSE 0::float8 END)`;
}

/**
 * Build the local table's tiered sort key for one match strategy.
 *
 * The result is the score expression AND the sort key: the statement selects it under an alias and orders by
 * that alias, so the ranking has exactly one authoritative definition and cannot drift from the order rows
 * come back in.
 *
 * @param strategy - The chosen match strategy, carrying the query's pre-parsed terms (never `none` — the DAL
 *   short-circuits that before it needs a sort key).
 * @param baseMetric - This statement's base metric expression (`word_similarity(query, name)`).
 * @returns The score to select and order by. Pure.
 */
export function localTieredSortKey(strategy: Exclude<IngredientMatchStrategy, { kind: 'none' }>, baseMetric: SQL): SQL {
    const rawAffinity = rawAffinitySql(strategy);

    return sql`((${TIER_GAP}::float8 * ${rankTierSql(strategy.terms)}::float8
        + LEAST(GREATEST(${baseMetric}, 0::float8), ${BASE_METRIC_MAX}::float8)${rawAffinity ?? sql``}
    ) / ${SCORE_CEILING}::float8)::float8`;
}
