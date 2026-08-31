/**
 * The tier LADDER — one structural rule layered ABOVE each search surface's base metric, never replacing it
 * (plan U5, KTD-1, R1–R5).
 *
 * DESIGN PATTERN: **Specification / Policy module**, in the shape of `recipes/domain/provenancePolicy.ts` and
 * `resolution/verificationGatePolicy.ts` — total, pure, I/O-free, and testable as a truth table. It owns the
 * weights, the tier gap and the score-is-sort-key rule; it owns no SQL and no notion of which surface it is
 * ranking.
 *
 * ## What went wrong, measured rather than argued
 *
 * Measured in Postgres 16 with `pg_trgm` on 2026-08-22:
 *
 * | expression                                                            | value |
 * | --------------------------------------------------------------------- | ----- |
 * | `word_similarity('flour', 'Flour')`                                   | 1.00  |
 * | `word_similarity('flour', 'Carob flour')`                             | 1.00  |
 * | `similarity('Carob flour', 'flour')`                                  | 0.50  |
 * | `similarity('Flour, wheat, all-purpose, enriched, bleached', 'flour')` | 0.15  |
 *
 * ⛔ These are TWO different failures and the earlier framing named neither. On recipe-service's LOCAL table
 * `word_similarity` TIES at 1.00 and `name ASC` breaks the tie alphabetically, so `Carob flour` wins
 * outright. On the food CATALOG there is no tie at all — there is a length PENALTY, and for a realistic USDA
 * row it points the wrong way: the short attractor scores 0.50 and the row a cook wants scores 0.15.
 *
 * KTD-1 forbids the obvious repair on the catalog side. Swapping `similarity` for `word_similarity` was
 * measured at **4 regressions and 0 fixes** (precision 26 → 22) because `word_similarity` does not penalise
 * extra words, and the penalty is also what makes `Chives, raw` beat `Chives, freeze-dried` for free. So the
 * ladder is **additive**: a structural tier dominates any base-metric difference, and INSIDE a tier the base
 * metric — penalty and all — still decides.
 *
 * ## The five tiers, worst first
 *
 * | tier       | holds when                                                | what it buys                                    |
 * | ---------- | --------------------------------------------------------- | ----------------------------------------------- |
 * | `base`     | nothing structural                                        | typos survive on the base metric alone (`flor`) |
 * | `covered`  | every query token appears as a whole word in the name      | multi-word conjunction; the attractors land here |
 * | `head`     | the name's head term is the query's head term              | `flour` → `Flour, wheat, …` over `Carob flour`   |
 * | `tokenSet` | the name and the query are the same set of tokens          | word-order inversion (`red wine vinegar`)        |
 * | `exact`    | the folded name IS the folded query                        | the name that is the token wins outright         |
 *
 * The head rule's asymmetry between a name and a query is the load-bearing part and lives in
 * `describeRankingQuery` (`./rankingTerms.ts`).
 *
 * ## The score is the SORT KEY, and it stays inside `[0, 1)`
 *
 * `score = (TIER_GAP × tier + clamp(base) + rawBonus) / SCORE_CEILING`.
 *
 * ⛔ The normalization is not cosmetic. food-service assigns an exact barcode / external-key crosswalk hit a
 * score of exactly `1` and unshifts it (`foods.service.ts`), and recipe-service's `FoodCatalogGateway`
 * re-sorts the page by that score — so a tiered score above 1 would silently demote an exact IDENTIFIER
 * match below a lexical one. Keeping the whole ladder under 1 preserves that invariant with no change to the
 * published wire contract, which documents `1` as the crosswalk value.
 */

/** The tiers, worst first — so a tier's ordinal IS its index. */
export const RANK_TIERS = ['base', 'covered', 'head', 'tokenSet', 'exact'] as const;

/** One rung of the ladder. */
export type RankTier = (typeof RANK_TIERS)[number];

/**
 * The largest value either surface's base metric can take. `similarity` and `word_similarity` are both
 * defined on `[0, 1]`.
 */
/**
 * The RANKER'S VERSION — part of every band-authority key (plan U3, R15).
 *
 * ⛔ Bump this on ANY change that moves ranked results: the tier ladder, `describeRankingName`'s head
 * rule, the relevance SQL renderings, or a popularity-prior change (plan U5). A bump makes every band
 * re-earn authority from scratch under the new version — the old rows stay as history — because a band's
 * measured agreement is a fact about the ranker that produced it, not about the band label.
 *
 * ⚠️ An accidental edit is a silent full authority reset, so the constant is PINNED by test the way
 * `engineVersionDiff.test.ts` pins the RDS engine: changing it must be a decision, not a side effect.
 * The current value names the U1 comma-segment head-rule era.
 */
export const RANKER_VERSION = 'ladder-v2-comma-head';

export const BASE_METRIC_MAX = 1;

/**
 * The distance between two rungs.
 *
 * ⚠️ It must exceed `BASE_METRIC_MAX + RAW_AFFINITY_BONUS`, or the ladder is decorative: the best row of a
 * lower tier would outrank the worst row of a higher one. `rankingTiers.test.ts` proves that executably for
 * every adjacent pair, so a later weight edit cannot break it silently.
 */
export const TIER_GAP = 2;

/**
 * How much a `raw` affinity is worth (plan U6): strictly inside one tier, so injecting `raw` can re-order
 * two rows that already tie structurally and can never promote one past a better-matching row.
 */
export const RAW_AFFINITY_BONUS = 0.5;

/** The divisor that keeps the whole scale inside `[0, 1)` — one full gap above the top rung. */
export const SCORE_CEILING = TIER_GAP * (RANK_TIERS.length + 1);

/**
 * A tier's ordinal.
 *
 * @param tier - The rung.
 * @returns Its index in {@link RANK_TIERS}. Pure.
 */
export function rankTierOrdinal(tier: RankTier): number {
    return RANK_TIERS.indexOf(tier);
}

/** The shape both {@link classifyRankTier} operands take — see `rankingTerms.ts`. */
interface Terms {
    readonly folded: string;
    readonly tokens: readonly string[];
    readonly head: string | undefined;
}

/** Whether two token lists denote the same SET (multiplicity ignored). Pure. */
function sameTokenSet(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);

    return left.size === right.size && [...left].every((token) => right.has(token));
}

/**
 * Which rung a candidate name occupies for a given query.
 *
 * Total by construction: every pair lands on exactly one rung, and an empty query or an empty name lands on
 * `base` rather than being promoted by a vacuous comparison — `''` equals `''` and `[].every()` is `true`,
 * so both are guarded explicitly.
 *
 * @param name - The candidate's terms (`describeRankingName`).
 * @param query - The query's terms (`describeRankingQuery`).
 * @returns The rung. Pure.
 */
export function classifyRankTier(name: Terms, query: Terms): RankTier {
    if (query.tokens.length === 0 || name.tokens.length === 0) {
        return 'base';
    }

    if (name.folded === query.folded) {
        return 'exact';
    }

    if (sameTokenSet(name.tokens, query.tokens)) {
        return 'tokenSet';
    }

    if (query.head !== undefined && name.head === query.head) {
        return 'head';
    }

    const nameTokens = new Set(name.tokens);

    if (query.tokens.every((token) => nameTokens.has(token))) {
        return 'covered';
    }

    return 'base';
}

/** The inputs to one row's score. */
export interface TieredScoreInput {
    /** The rung {@link classifyRankTier} put this row on. */
    readonly tier: RankTier;
    /** This surface's base metric for the row — `similarity` on the catalog, `word_similarity` locally. */
    readonly baseMetric: number;
    /** Whether the match strategy injected `raw` AND this row carries it (plan U6). */
    readonly rawAffinity: boolean;
}

/**
 * The score, which is also the sort key — one authoritative definition, so the ranking cannot drift from the
 * order rows come back in.
 *
 * The base metric is CLAMPED rather than trusted. Nothing in the type system stops a future base metric from
 * exceeding 1, and an unclamped one would let a lower tier cross a higher one — turning the ladder's central
 * guarantee into a convention.
 *
 * @param input - The rung, the base metric, and the raw affinity.
 * @returns A score in `[0, 1)`. Pure.
 */
export function tieredRelevanceScore(input: TieredScoreInput): number {
    const base = Math.min(Math.max(input.baseMetric, 0), BASE_METRIC_MAX);
    const bonus = input.rawAffinity ? RAW_AFFINITY_BONUS : 0;

    return (TIER_GAP * rankTierOrdinal(input.tier) + base + bonus) / SCORE_CEILING;
}

/** One scored row, as either surface's statement returns it. */
export interface TieredHit {
    readonly score: number;
    readonly name: string;
}

/**
 * The total order both statements' `ORDER BY score DESC, name ASC` implements: best score first, ties broken
 * on name so a page is deterministic across calls.
 *
 * ⚠️ `localeCompare` here is the TypeScript mirror of Postgres' `name ASC` under the RDS collation. U1 made
 * "local tracks the RDS major version and collation provider" a continuous invariant precisely because 99.7%
 * of tiebreak positions move when it does not — this comparator inherits that invariant rather than
 * restating it, and `rankingConformance.ts` is where the two are actually compared.
 *
 * @param a - One hit.
 * @param b - The other.
 * @returns Negative when `a` sorts first. Pure.
 */
export function compareTieredHits(a: TieredHit, b: TieredHit): number {
    return b.score - a.score !== 0 ? b.score - a.score : a.name.localeCompare(b.name);
}
