/**
 * THE INGREDIENT MATCH STRATEGY (plan U6, R6–R8, R10) — which candidates the local `ingredients` statement
 * retrieves, decided purely and without a database before any SQL is built.
 *
 * DESIGN PATTERN: **Strategy chosen by a pure selector**, mirroring food-service's `selectSearchStrategy`
 * exactly: a discriminated union that `IngredientsDal.search` dispatches on with an exhaustive switch (the
 * switch over the union tag IS the Visitor, so no class hierarchy is added for it). The routing decision is
 * therefore a truth table, and the DAL has nothing left in it to get wrong but the query text.
 *
 * ## The retrieval defect this closes, stated concretely
 *
 * `plainto_tsquery` builds a CONJUNCTION of every lexeme, so today's statement requires a row to carry ALL
 * of them. A cook (or the importer) writing `sifted flour` therefore asks for `sift & flour`, and
 * `Flour, wheat, all-purpose` — the row they meant — carries only one of the two. The trigram fallback does
 * not rescue it either: `word_similarity('sifted flour', 'Flour, wheat, all-purpose')` sits under the 0.6
 * `<%` threshold, and `ILIKE '%sifted flour%'` is a literal substring. The row is never RETRIEVED, so no
 * amount of ranking can reach it. That is the shape of the import's 268 lines that matched nothing.
 *
 * A multi-token query therefore also retrieves on its HEAD TERM alone. The extra candidates are not noise
 * because they arrive into U5's tier ladder: a head-term row lands on the `head` rung, a row that merely
 * shares a modifier lands on `base`, and the `LIMIT` still cuts in the right place.
 *
 * ⛔ **This is why U6 declares U5 as a dependency.** Widening retrieval against the OLD sort key would make
 * the page worse, not better. The two land together or not at all.
 *
 * ## `raw` injection
 *
 * The catalog names an unprocessed food `Celery, raw` / `Chives, raw`; cooks write `celery`. Published prior
 * art (FoodOntoRAG, Epicure) injects the term to bridge that. Here it is a bounded RANKING affinity, never a
 * retrieval filter: it can re-order two rows that already tie structurally, and
 * `RAW_AFFINITY_BONUS + BASE_METRIC_MAX < TIER_GAP` means it can never promote a row past a better-matching
 * one. Two suppressions, both from the plan: foods that are never raw, and a query that already names a
 * preparation.
 *
 * ⚠️ **Unmeasured against the import corpus.** The corpus is an operator-downloaded file deliberately absent
 * from this repository (ADR-0023), so the suppression list and the preparation list are reasoned, not
 * fitted. They are ordinary word lists and are expected to grow; what must not change is that the bonus
 * stays inside one rung.
 */
import { describeRankingQuery, singularizeRankingToken } from '@kitchensink/recipe-core/resolution/ranking-terms';
import type { RankingTerms } from '@kitchensink/recipe-core/resolution/ranking-terms';

/**
 * Head terms that are never `raw` — a processed or manufactured food, where a `raw` affinity would prefer a
 * row that does not exist or, worse, a genuinely raw INGREDIENT of the thing the cook asked for.
 *
 * ⚠️ Singularized, because that is the form a head term arrives in.
 */
const NEVER_RAW_HEADS: ReadonlySet<string> = new Set([
    'bread',
    'broth',
    'butter',
    'cheese',
    'chocolate',
    'cocoa',
    'cream',
    'flour',
    'honey',
    'jam',
    'jelly',
    'juice',
    'ketchup',
    'mayonnaise',
    'milk',
    'molass',
    'mustard',
    'oil',
    'pasta',
    'sauce',
    'stock',
    'sugar',
    'syrup',
    'vanilla',
    'vinegar',
    'wine',
    'yogurt',
]);

/**
 * Preparation terms. A query carrying any of them has already told us how the food was treated, so a `raw`
 * affinity would contradict the cook.
 *
 * ⛔ These are GRAMMAR for this decision, not culinary vocabulary, and they are never deleted from the query
 * — U7's "preparation verbs are labelled, not deleted" applies here too. Their only effect is to switch the
 * affinity off.
 */
const PREPARATION_TERMS: ReadonlySet<string> = new Set([
    'baked',
    'blanched',
    'boiled',
    'braised',
    'broiled',
    'canned',
    'cooked',
    'cured',
    'dried',
    'fried',
    'frozen',
    'grilled',
    'pickled',
    'poached',
    'raw',
    'roasted',
    'sauteed',
    'smoked',
    'steamed',
    'stewed',
    'toasted',
]);

/**
 * How `IngredientsDal.search` retrieves for one query.
 *
 * - `none` — nothing searchable survived tokenization; the caller returns no rows WITHOUT a round trip.
 * - `singleToken` — today's retrieval predicate, byte for byte. `flor` → `All-purpose flour` depends on it
 *   (`word_similarity` 0.600, KTD-1), and nothing about a one-token query needs widening.
 * - `multiToken` — today's predicate OR'd with a head-term retrieval, so the row a cook meant is in the
 *   candidate set even when it carries none of their modifiers.
 */
export type IngredientMatchStrategy =
    | { readonly kind: 'none' }
    | {
          readonly kind: 'singleToken';
          /** The query's ranking terms, parsed once for both retrieval and the tier ladder. */
          readonly terms: RankingTerms;
          /** Whether rows carrying `raw` get this query's bounded ranking affinity. */
          readonly rawAffinity: boolean;
      }
    | {
          readonly kind: 'multiToken';
          readonly terms: RankingTerms;
          /**
           * The single term the widened retrieval matches on.
           *
           * ⚠️ It is `terms.head` and not a second derivation: retrieval and ranking must name the SAME head
           * or the statement retrieves rows the ladder then refuses to promote. Surfaced as its own field so
           * the DAL reads what it means rather than reaching into the terms.
           */
          readonly headTerm: string;
          readonly rawAffinity: boolean;
      };

/**
 * Whether this query should prefer rows carrying `raw`.
 *
 * @param terms - The query's ranking terms.
 * @returns True when no preparation is named and the head is not a never-raw food. Pure.
 */
function shouldPreferRaw(terms: RankingTerms): boolean {
    if (terms.head === undefined || NEVER_RAW_HEADS.has(terms.head)) {
        return false;
    }

    return !terms.tokens.some((token) => PREPARATION_TERMS.has(singularizeRankingToken(token)));
}

/**
 * Choose the retrieval strategy for one ingredient query. Pure, and database-free by construction.
 *
 * @param query - The (already trimmed) user or importer query.
 * @returns The strategy the DAL dispatches on.
 */
export function selectIngredientMatchStrategy(query: string): IngredientMatchStrategy {
    const terms = describeRankingQuery(query);

    if (terms.tokens.length === 0 || terms.head === undefined) {
        return { kind: 'none' };
    }

    const rawAffinity = shouldPreferRaw(terms);

    if (terms.tokens.length === 1) {
        return { kind: 'singleToken', terms, rawAffinity };
    }

    return { kind: 'multiToken', terms, headTerm: terms.head, rawAffinity };
}
