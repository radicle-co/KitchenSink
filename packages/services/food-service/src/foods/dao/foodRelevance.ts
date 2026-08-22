/**
 * The CATALOG Scoring Policy (plan U5, R1–R5) — the one authoritative definition of how `food` rows are
 * ordered for a text query, rendered as the SQL that `FoodSearchDao.relevanceQuery` sorts on.
 *
 * DESIGN PATTERN: **Policy module + Builder.** The *rule* — which rungs exist, what each means, how a rung
 * and a base metric combine into a score — lives once, purely, in
 * `@kitchensink/recipe-core/resolution/ranking-tiers`. This module is the catalog's **renderer** of that
 * rule: it binds the query's terms, emits the per-row lateral, and composes the score with the catalog's own
 * base metric. It decides nothing the pure policy has not already decided.
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
 * ## Two SQL facts worth knowing before editing the fragments
 *
 *  - `normalize(text, NFD)` is core PostgreSQL from 13 and needs no extension. ⛔ `unaccent` is NOT used:
 *    its rules file is not NFD, so it could not be mirrored exactly in TypeScript, and it would put an
 *    extension into a migration this unit does not own.
 *  - PostgreSQL's ARE regex accepts `\uXXXX` escapes, so the combining-mark range travels as an escape
 *    rather than as literal invisible characters in this source file (verified against `postgres:16`,
 *    2026-08-22).
 */
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import type { RankingTerms } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { BASE_METRIC_MAX, SCORE_CEILING, TIER_GAP } from '@kitchensink/recipe-core/resolution/ranking-tiers';

/**
 * The lateral alias the per-row ranking terms are computed under.
 *
 * ⚠️ It is written LITERALLY in the fragments below rather than interpolated — `sql.raw` is banned in this
 * repository (it splices its argument into the statement text) and an identifier cannot be a bound
 * parameter. `__tests__/foodRelevance.test.ts` asserts that both fragments contain this constant, which is
 * what stops the two from drifting apart.
 */
export const CATALOG_RANK_TERMS_ALIAS = 'rank_terms';

/**
 * The regex literals the fold and the tokenizer use, mirroring `rankingTerms.ts` character for character.
 *
 * ⚠️ They travel as BOUND PARAMETERS, not as spliced text: `regexp_replace`, `regexp_split_to_table` and `~`
 * all take their pattern as a VALUE. The unit test therefore asserts them through `params` rather than
 * through the statement text, which additionally proves they are parameterised.
 */
const REGEX = {
    /** Unicode combining marks — what NFD splits an accented letter into. */
    combiningMarks: '[\\u0300-\\u036f]',
    /**
     * Whitespace, as the SAME explicit ASCII class `rankingTerms.ts` uses.
     *
     * ⛔ NOT `[[:space:]]`, which disagrees with JavaScript's `\s` on NBSP. The disagreement would only ever
     * surface as a mis-ranked row nobody could reproduce.
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

/**
 * The SQL mirror of `foldForRanking`: lower-case, NFD, strip combining marks, collapse whitespace, trim.
 *
 * ⚠️ The steps are in the SAME ORDER as the TypeScript. Folding case after decomposition, or trimming before
 * collapsing, would give a different answer for at least one input, and nothing but the conformance contract
 * would notice.
 *
 * @param column - The column expression holding the name.
 * @returns The folded-name expression. Pure.
 */
function foldedNameSql(column: SQL): SQL {
    return sql`btrim(regexp_replace(
        regexp_replace(normalize(lower(${column}), NFD), ${REGEX.combiningMarks}, '', 'g'),
        ${REGEX.asciiWhitespace}, ' ', 'g'
    ), ' ')`;
}

/**
 * The SQL mirror of `rankingTokens`: split the folded name on non-alphanumeric runs, drop empties, apply
 * both arms of the plural rule, and PRESERVE ORDER.
 *
 * ⚠️ `WITH ORDINALITY` + `ORDER BY` is not decoration. A set-returning function's output order is not
 * guaranteed by the standard, and the head rung reads `tokens[1]` — so an unordered array would break the
 * head rule intermittently, which is the worst failure mode available.
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

/** A tiered sort key: the lateral that computes a row's terms, and the score expression over it. */
export interface TieredSortKey {
    /**
     * The `CROSS JOIN LATERAL … AS rank_terms` clause the statement MUST include. Computing the fold and the
     * token array once per row, rather than inlining them into four predicates, is what keeps the ladder's
     * per-row cost to one `regexp_split_to_table`.
     */
    readonly lateral: SQL;
    /**
     * The score expression — which is ALSO the sort key, referenced by its output alias, so the ranking has
     * exactly one authoritative definition and cannot drift from the order rows come back in.
     */
    readonly score: SQL;
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
    // to an array, which is a different expression that happens to parse. `sql.param` binds the array as a
    // single value. Asserted by `__tests__/foodRelevance.test.ts`.
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
 * Build the catalog's tiered sort key for one query.
 *
 * @param query - The trimmed user query.
 * @param baseMetric - This statement's base metric expression (the catalog's `GREATEST(…, similarity(…))`).
 * @returns The lateral to join, and the score to select and order by. Pure.
 */
export function catalogTieredSortKey(query: string, baseMetric: SQL): TieredSortKey {
    const terms = describeRankingQuery(query);

    return {
        lateral: sql`CROSS JOIN LATERAL (
            SELECT folded_name.value AS folded, ${rankingTokensSql()} AS tokens
            FROM (SELECT ${foldedNameSql(sql`food.name`)}) AS folded_name(value)
        ) AS rank_terms`,
        score: sql`((${TIER_GAP}::float8 * ${rankTierSql(terms)}::float8
            + LEAST(GREATEST(${baseMetric}, 0::float8), ${BASE_METRIC_MAX}::float8)
        ) / ${SCORE_CEILING}::float8)::float8`,
    };
}
