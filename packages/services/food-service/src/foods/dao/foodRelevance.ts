/**
 * The CATALOG Scoring Policy (plan U5, R1–R5) — the one authoritative definition of how `food` rows are
 * ordered for a text query, rendered as the SQL that `FoodSearchDao.relevanceQuery` sorts on.
 *
 * DESIGN PATTERN: **Policy module + Builder.** The *rule* — which rungs exist, what each means, how a rung
 * and a base metric combine into a score — lives once, purely, in
 * `@kitchensink/recipe-core/resolution/ranking-tiers`. This module is the catalog's **renderer** of that
 * rule: it binds the query's terms, reads the ranking columns migration 0008 materializes, and composes the
 * score with the catalog's own base metric. It decides nothing the pure policy has not already decided.
 *
 * ## ⛔ Why the rule is shared but the SQL is NOT
 *
 * recipe-service ranks its local `ingredients` table with a different statement over a different base metric
 * (`word_similarity`, which the `flor` → `All-purpose flour` case needs at exactly 0.600 — KTD-1). Factoring
 * the two statements together would couple two services' query construction through a package that would
 * then need drizzle. So the plan's rule is "shared rule, never shared SQL": the vocabulary is one module in
 * `recipe-core`, this file and `recipe-service/src/ingredients/dal/ingredientRelevance.ts` are two
 * renderings of it, and `@kitchensink/service-test-harness`'s `registerRankingConformance` contract — run by
 * BOTH services against their own DAL and a real database — is what proves the renderings still agree with
 * the rule and with each other.
 *
 * ## What the tiers buy on THIS surface, measured
 *
 * The catalog's base metric penalises length, and KTD-1 keeps that on purpose. Measured on `postgres:16`
 * with `pg_trgm`, 2026-08-22, for the query `flour`:
 *
 * | row                                            | `similarity` |
 * | ---------------------------------------------- | ------------ |
 * | `Carob flour`                                  | 0.50         |
 * | `Flour, wheat, all-purpose, enriched, bleached` | 0.15         |
 *
 * So on a realistic USDA catalog the attractor wins by more than 3×, and no re-weighting of `similarity`
 * fixes it without giving up the penalty that also makes `Chives, raw` beat `Chives, freeze-dried` for free.
 * The head rung lifts the row whose HEAD TERM is `flour` a whole tier above the row that merely contains the
 * word, and inside that tier the penalty still decides. Additive, not a replacement.
 *
 * ## ⛔ The ranking terms are MATERIALIZED, and that was forced by measurement
 *
 * The fold, the tokenizer and the plural rule are not in this file. They live in migration
 * `0008_food_rank_terms.sql` as two STORED generated columns, because computing them per row is
 * unaffordable: on a 50,000-row production-shaped store (2026-08-22, p95 over 20 runs) the per-row form
 * measured **253ms** on SC-007's `broad` shape and **357ms** on `brand` — against a 200ms budget and a
 * pre-U5 baseline of 15ms and 24ms. Materialized, the whole ladder costs **+0.8ms** and **+5.2ms**.
 *
 * That constraint also shaped the RULE, not only its storage: a generated-column expression may not contain
 * a subquery, so the plural fold is applied to whole text with two global `regexp_replace`s rather than per
 * token — which is exactly why `rankingTerms.ts` defines `singularizeRankingText` and derives the per-token
 * form from it rather than the other way round. Read the migration's header before changing either.
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { RankingTerms } from '@kitchensink/recipe-core/resolution/ranking-terms';
import {
    BASE_METRIC_MAX,
    SCORE_CEILING,
    TIER_GAP,
    rankTierOrdinal,
} from '@kitchensink/recipe-core/resolution/ranking-tiers';
import type { RankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';

/**
 * The columns migration `0008_food_rank_terms.sql` materializes: the SQL mirror of `foldForRanking(name)`
 * and `rankingTokens(name)`, computed once on write by Postgres rather than per row on every search.
 *
 * ⛔ **Computing them in the statement was MEASURED and rejected.** On a 50,000-row production-shaped store
 * (2026-08-22, p95 over 20 runs) the per-row form cost 253ms on SC-007's `broad` shape and 357ms on `brand`,
 * against a 200ms budget and a pre-U5 baseline of 15ms and 24ms. Materialized, the same ladder costs +0.8ms
 * and +5.2ms. The migration's header carries the full table and the three constraints that shaped the
 * generated expressions.
 */
const RANK_FOLDED = 'food.rank_folded';

/** The materialized token array. The head term lives in `rank_head` (U1) — not `[1]`. */
const RANK_TOKENS = 'food.rank_tokens';

/** The materialized synonym keys (migration 0026): `rankingKeyOf` of each alias. */
const RANK_ALIAS_KEYS = 'food.rank_alias_keys';

/** The materialized default keys (migration 0027): `rankingKeyOf` of each default term (ADR-0070 §4). */
const RANK_DEFAULT_KEYS = 'food.rank_default_keys';

/** The materialized head term (migrations 0011, 0025): `rankingHeadOf(name)`. */
const RANK_HEAD = 'food.rank_head';

/**
 * A rung's ordinal as a BOUND integer. Read from `RANK_TIERS`, so inserting a rung cannot leave a stale number in the
 * `CASE`. ⚠️ The `::int` is required: a `CASE` whose every branch is a parameter resolves its type to text.
 *
 * @param tier - The rung.
 * @returns The bound ordinal. Pure.
 */
function rung(tier: RankTier): SQL {
    return sql`${rankTierOrdinal(tier)}::int`;
}

/**
 * The tier expression: a `CASE` whose branches are the ladder, highest rung first, so the first branch that
 * holds is the highest rung that holds. The `base` rung is the `ELSE`, which is what makes the ladder TOTAL.
 *
 * ⚠️ An empty query is resolved at BUILD time rather than in SQL. `'{}' <@ anything` is TRUE and
 * `[].every()` is vacuously true, so a query with no tokens would otherwise be promoted to `covered` — and,
 * against an equally token-less name, to `tokenSet` — by two vacuous comparisons. `classifyRankTier` guards
 * that in TypeScript; here the guard is that no ladder is emitted at all.
 *
 * @param terms - The query's terms, pre-computed in TypeScript.
 * @returns An integer expression in `[0, RANK_TIERS.length - 1]`. Pure.
 */
function rankTierSql(terms: RankingTerms): SQL {
    if (terms.tokens.length === 0) {
        return sql`0`;
    }

    // ⛔ `sql.param(...)`, NOT a bare `${array}`. Drizzle FLATTENS a plain array interpolation into one
    // placeholder per element, so `${tokens}::text[]` renders as `($1, $2)::text[]` — a ROW constructor cast
    // to an array, which is a different expression that happens to parse. Asserted by the unit test.
    const queryTokens = sql`${sql.param([...terms.tokens])}::text[]`;

    // ⚠️ The column names below are spelled again in `CATALOG_RANK_TERM_COLUMNS`; the unit test holds the two equal.
    return sql`(CASE
        WHEN food.rank_folded = ${terms.folded} THEN ${rung('exact')}
        WHEN ${terms.key} = ANY(food.rank_alias_keys) THEN ${rung('synonym')}
        WHEN ${terms.key} = ANY(food.rank_default_keys) THEN ${rung('default')}
        WHEN food.rank_tokens <@ ${queryTokens} AND ${queryTokens} <@ food.rank_tokens THEN ${rung('tokenSet')}
        WHEN food.rank_head = ${terms.head ?? null} THEN ${rung('head')}
        WHEN ${queryTokens} <@ food.rank_tokens THEN ${rung('covered')}
        ELSE ${rung('base')}
    END)`;
}

/**
 * The rung a row sits on for one query, as an integer ordinal: the same `CASE` the sort key is built from, selected
 * on its own so a hit can publish its rung without decoding it from a float score.
 *
 * ⚠️ The statement therefore carries the `CASE` twice (here and inside the score). Postgres evaluates both; folding
 * them into one subquery is a separate change, measured against SC-007 before it is made.
 *
 * @param terms - The query's terms (`describeRankingQuery`), computed once per statement.
 * @returns An integer expression in `[0, RANK_TIERS.length - 1]`. Pure.
 */
export function catalogRankTierOrdinal(terms: RankingTerms): SQL {
    return rankTierSql(terms);
}

/**
 * Build the catalog's tiered sort key for one query.
 *
 * The result is the score expression AND the sort key: the statement selects it under an alias and orders by
 * that alias, so the ranking has exactly one authoritative definition and cannot drift from the order rows
 * come back in.
 *
 * @param terms - The query's terms (`describeRankingQuery`), computed once per statement.
 * @param baseMetric - This statement's base metric expression (the catalog's `GREATEST(…, similarity(…))`).
 * @returns The score to select and order by. Pure.
 */
export function catalogTieredSortKey(terms: RankingTerms, baseMetric: SQL): SQL {
    const clampedBase = sql`LEAST(GREATEST(${baseMetric}, 0::float8), ${BASE_METRIC_MAX}::float8)`;

    return sql`((${TIER_GAP}::float8 * ${rankTierSql(terms)}::float8
        + ${clampedBase}
    ) / ${SCORE_CEILING}::float8)::float8`;
}

/** The materialized columns this policy reads, exported so the unit test can assert the statement names them. */
export const CATALOG_RANK_TERM_COLUMNS = [
    RANK_FOLDED,
    RANK_TOKENS,
    RANK_HEAD,
    RANK_ALIAS_KEYS,
    RANK_DEFAULT_KEYS,
] as const;
