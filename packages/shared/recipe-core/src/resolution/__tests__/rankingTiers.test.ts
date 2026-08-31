/**
 * The tier LADDER and its arithmetic — the rule that layers structure above each surface's base metric
 * without replacing it (plan U5, KTD-1).
 *
 * ## The defect this exists to close, measured rather than argued
 *
 * Measured in Postgres 16 with `pg_trgm` on 2026-08-22, against the three attractors the import produced:
 *
 * | expression                                                        | value |
 * | ----------------------------------------------------------------- | ----- |
 * | `similarity('Carob flour', 'flour')`                              | 0.50  |
 * | `similarity('Flour, wheat, all-purpose, enriched, bleached', 'flour')` | 0.15  |
 * | `word_similarity('flour', 'Carob flour')`                         | 1.00  |
 * | `word_similarity('flour', 'Flour')`                               | 1.00  |
 *
 * Two different failures, one shape. On the LOCAL table `word_similarity` ties at 1.00 and `name ASC` breaks
 * the tie alphabetically, so `Carob flour` wins outright. On the CATALOG there is no tie — there is a length
 * PENALTY, and it points the wrong way for a realistic USDA row: the short attractor scores 0.50 and the
 * name a cook actually wants scores 0.15.
 *
 * ⛔ KTD-1 forbids removing that penalty (swapping `similarity` for `word_similarity` measured 4 regressions
 * and 0 fixes; the penalty is what makes `Chives, raw` beat `Chives, freeze-dried` for free). So the ladder
 * layers ABOVE the base metric: a structural tier dominates any base-metric difference, and inside a tier the
 * base metric — penalty and all — still decides.
 *
 * ## Mutation lens
 *
 * The gap test is the one that matters: it fails if {@link TIER_GAP} is edited down, if
 * {@link BASE_METRIC_MAX} is raised, or if {@link RAW_AFFINITY_BONUS} is raised to where it can cross a
 * tier — the three ways a later weight edit could silently un-tier the sort key while every example-shaped
 * test stayed green.
 */
import { describe, expect, it } from 'vitest';

import { describeRankingName, describeRankingQuery } from '../rankingTerms.js';
import {
    RANKER_VERSION,
    BASE_METRIC_MAX,
    RANK_TIERS,
    RAW_AFFINITY_BONUS,
    TIER_GAP,
    classifyRankTier,
    compareTieredHits,
    rankTierOrdinal,
    tieredRelevanceScore,
} from '../rankingTiers.js';

/** Classify a (name, query) pair the way a surface's statement does. */
function tierOf(name: string, query: string): string {
    return classifyRankTier(describeRankingName(name), describeRankingQuery(query));
}

describe('the ladder', () => {
    it('is ordered worst-first, so a tier IS its ordinal', () => {
        expect(RANK_TIERS).toEqual(['base', 'covered', 'head', 'tokenSet', 'exact']);
        expect(RANK_TIERS.map(rankTierOrdinal)).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('classifyRankTier', () => {
    it('promotes the name that IS the query to `exact`', () => {
        expect(tierOf('Flour', 'flour')).toBe('exact');
        expect(tierOf('Flour, all purpose', 'flour, all purpose')).toBe('exact');
    });

    it('promotes a word-order inversion to `tokenSet`', () => {
        // The published token-sort technique, as a tier. `flour, all purpose` vs `all purpose flour` is the
        // difference `representativeUserInput.test.ts` records against "ranking (U5/U6)".
        expect(tierOf('Flour, all purpose', 'all purpose flour')).toBe('tokenSet');
        expect(tierOf('Vinegar, red wine', 'red wine vinegar')).toBe('tokenSet');
        expect(tierOf('Sugars, brown', 'brown sugar')).toBe('tokenSet');
    });

    it('promotes a shared head term to `head`, which is how a long USDA name beats a short attractor', () => {
        expect(tierOf('Flour, wheat, all-purpose, enriched, bleached', 'flour')).toBe('head');
        expect(tierOf('Sugars, brown', 'sugar')).toBe('head');
        expect(tierOf('Milk, whole, 3.25% milkfat', 'milk')).toBe('head');
    });

    it('bridges a plural at the head, which is how `eggs` reaches `Egg, whole, raw`', () => {
        expect(tierOf('Egg, whole, raw', 'eggs')).toBe('head');
        expect(tierOf('Chives, raw', 'chives')).toBe('head');
    });

    it('bridges a diacritic, which is how `jalapeño` reaches the catalog row spelled without one', () => {
        expect(tierOf('Peppers, jalapeno, raw', 'jalapeño peppers')).toBe('head');
        expect(tierOf('Jalapeno', 'jalapeño')).toBe('exact');
    });

    it('leaves each ATTRACTOR at `covered` — it contains the query, and that is all it does', () => {
        expect(tierOf('Carob flour', 'flour')).toBe('covered');
        expect(tierOf('Crackers, milk', 'milk')).toBe('covered');
        expect(tierOf('Candies, sugar-coated almonds', 'sugar')).toBe('covered');
    });

    it('requires EVERY query token for `covered`, so a partial overlap stays at `base`', () => {
        expect(tierOf('Wine, red, table', 'red wine vinegar')).toBe('base');
    });

    it('leaves a typo at `base`, where the base metric is the only thing that can rescue it', () => {
        // `flor` → `All-purpose flour` scores 0.600 by word_similarity. The ladder must not get in its way.
        expect(tierOf('All-purpose flour', 'flor')).toBe('base');
    });

    it('never promotes an empty query', () => {
        expect(tierOf('Flour', '   ')).toBe('base');
    });

    it('never promotes on an empty name', () => {
        expect(tierOf('   ', 'flour')).toBe('base');
    });
});

describe('tieredRelevanceScore — the tier gap, proven executably', () => {
    it('keeps the whole scale inside [0, 1), so a crosswalk hit still sorts first', () => {
        // food-service assigns an exact barcode / external-key crosswalk hit a score of exactly 1 and
        // unshifts it; the recipe gateway then re-sorts by score. A tiered score above 1 would silently
        // demote an exact identifier match below a lexical one.
        const best = tieredRelevanceScore({ tier: 'exact', baseMetric: BASE_METRIC_MAX, rawAffinity: true });
        const worst = tieredRelevanceScore({ tier: 'base', baseMetric: 0, rawAffinity: false });

        expect(best).toBeLessThan(1);
        expect(worst).toBeGreaterThanOrEqual(0);
    });

    it('⛔ makes the WORST row of a tier beat the BEST row of the tier below it — always', () => {
        for (const [index, tier] of RANK_TIERS.entries()) {
            if (index === 0) {
                continue;
            }

            const lower = RANK_TIERS[index - 1]!;
            const bestOfLower = tieredRelevanceScore({
                tier: lower,
                baseMetric: BASE_METRIC_MAX,
                rawAffinity: true,
            });
            const worstOfThis = tieredRelevanceScore({ tier, baseMetric: 0, rawAffinity: false });

            expect(worstOfThis).toBeGreaterThan(bestOfLower);
        }
    });

    it('keeps the raw bonus strictly inside a tier, so injecting `raw` can never re-tier a row', () => {
        expect(RAW_AFFINITY_BONUS + BASE_METRIC_MAX).toBeLessThan(TIER_GAP);
    });

    it('lets the base metric decide INSIDE a tier — the length penalty KTD-1 preserves', () => {
        const shortName = tieredRelevanceScore({ tier: 'head', baseMetric: 0.5, rawAffinity: false });
        const longName = tieredRelevanceScore({ tier: 'head', baseMetric: 0.15, rawAffinity: false });

        expect(shortName).toBeGreaterThan(longName);
    });

    it('breaks a within-tier tie with the raw bonus, which is how `Chives, raw` wins its query', () => {
        const raw = tieredRelevanceScore({ tier: 'head', baseMetric: 0.4, rawAffinity: true });
        const freezeDried = tieredRelevanceScore({ tier: 'head', baseMetric: 0.4, rawAffinity: false });

        expect(raw).toBeGreaterThan(freezeDried);
    });

    it('clamps a base metric outside [0, 1] rather than letting it cross a tier', () => {
        // Nothing in the type system stops a future base metric from exceeding 1. The clamp makes the gap
        // proof above hold unconditionally instead of by convention.
        expect(tieredRelevanceScore({ tier: 'base', baseMetric: 99, rawAffinity: false })).toBe(
            tieredRelevanceScore({ tier: 'base', baseMetric: BASE_METRIC_MAX, rawAffinity: false }),
        );
        expect(tieredRelevanceScore({ tier: 'base', baseMetric: -5, rawAffinity: false })).toBe(
            tieredRelevanceScore({ tier: 'base', baseMetric: 0, rawAffinity: false }),
        );
    });
});

describe('compareTieredHits — the score IS the sort key', () => {
    it('orders by score descending', () => {
        expect(compareTieredHits({ score: 0.2, name: 'a' }, { score: 0.9, name: 'b' })).toBeGreaterThan(0);
    });

    it('breaks a tie on name, so the order is deterministic across calls', () => {
        expect(compareTieredHits({ score: 0.5, name: 'Apple' }, { score: 0.5, name: 'Banana' })).toBeLessThan(0);
    });

    it('is a total order — reversing the arguments reverses the sign', () => {
        const a = { score: 0.5, name: 'Apple' };
        const b = { score: 0.5, name: 'Banana' };

        expect(Math.sign(compareTieredHits(a, b))).toBe(-Math.sign(compareTieredHits(b, a)));
    });
});

describe('RANKER_VERSION — the band-authority version key (plan U3, R15)', () => {
    /**
     * ⛔ PINNED deliberately, like `engineVersionDiff.test.ts` pins the RDS engine. Changing the ranker's
     * version resets EVERY band's earned authority to `observing` under the new key — that must be a
     * decision taken with a ladder/head-rule/prior change, never a drive-by edit. If you changed ranking
     * behavior, update BOTH together and say so in the commit.
     */
    it('is pinned to the current ladder era', () => {
        expect(RANKER_VERSION).toBe('ladder-v2-comma-head');
    });
});
