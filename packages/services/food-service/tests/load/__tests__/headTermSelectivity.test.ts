/**
 * The head-term selectivity LADDER — the arithmetic `perfFixture.ts` builds its weighted draw axes from
 * (plan U30).
 *
 * These cases cover the ladder as a value object: the Zipf weights, the largest-remainder apportionment
 * onto a cycle, and the draw axis that turns the two into an indexable table plus its SQL mirror. The
 * REALIZED distribution of the fixture that consumes them — the thing SC-007 actually measures — is
 * asserted separately in `perfFixtureDistribution.test.ts`, because a correct ladder wired into a name
 * template that ignores it would pass every case here.
 */
import { describe, expect, it } from 'vitest';

import {
    HEAD_TERM_RANKS,
    HEAD_TERM_REGIMES,
    HEAD_TERM_SELECTIVITY_P50,
    HEAD_TERM_SELECTIVITY_TAIL,
    HEAD_TERM_ZIPF_EXPONENT,
    apportion,
    assertDrawIndexFits,
    buildDrawAxis,
    drawFrom,
    drawFromSql,
    headTermRegime,
    zipfWeights,
} from '../headTermSelectivity.js';

/** The median of a numeric list, ascending or descending — the list is sorted here, not assumed. */
function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length / 2;

    return sorted.length % 2 === 1 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

describe('zipfWeights', () => {
    it('produces a normalized, strictly decreasing ladder', () => {
        const weights = zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT);

        expect(weights).toHaveLength(HEAD_TERM_RANKS);
        expect(weights.reduce((total, weight) => total + weight, 0)).toBeCloseTo(1, 10);

        for (let rank = 1; rank < weights.length; rank += 1) {
            expect(weights[rank]!).toBeLessThan(weights[rank - 1]!);
        }
    });

    it('lands on BOTH catalog anchors at the declared rank count and exponent', () => {
        // ⛔ The load-bearing case. `HEAD_TERM_RANKS` and `HEAD_TERM_ZIPF_EXPONENT` were solved to satisfy
        // these two measurements simultaneously; a change to either constant that keeps the shape "roughly
        // heavy-tailed" but drifts off the measured catalog fails here rather than silently re-baselining
        // what SC-007 is a measurement OF.
        const weights = zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT);

        expect(weights[0]!).toBeGreaterThan(HEAD_TERM_SELECTIVITY_TAIL * 0.9);
        expect(weights[0]!).toBeLessThan(HEAD_TERM_SELECTIVITY_TAIL * 1.1);
        expect(median(weights)).toBeGreaterThan(HEAD_TERM_SELECTIVITY_P50 * 0.9);
        expect(median(weights)).toBeLessThan(HEAD_TERM_SELECTIVITY_P50 * 1.1);
    });

    it('rejects a rank count that cannot carry both anchors', () => {
        // A vocabulary small enough that its MEAN weight already exceeds the measured p50 cannot be skewed
        // into that shape at all — the weights must sum to 1, so the median can never fall that far below
        // the mean while the maximum stays at the measured tail. Caught at construction, not by a puzzling
        // distribution assertion three modules away.
        expect(() => zipfWeights(8, HEAD_TERM_ZIPF_EXPONENT)).toThrow(/rank/iu);
    });
});

describe('apportion', () => {
    it('distributes a cycle with no remainder lost', () => {
        const counts = apportion(zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT), 997);

        expect(counts.reduce((total, count) => total + count, 0)).toBe(997);
    });

    it('keeps the ladder ordered and every rank non-empty', () => {
        const counts = apportion(zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT), 997);

        for (let rank = 1; rank < counts.length; rank += 1) {
            expect(counts[rank]!).toBeLessThanOrEqual(counts[rank - 1]!);
        }

        // ⛔ A rank apportioned ZERO occurrences is a vocabulary word the corpus never contains, so its
        // search probe matches nothing and `search.load.js`'s `expectHits` fails the whole run.
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    });

    it('refuses a cycle too small to give every rank an occurrence', () => {
        expect(() => apportion(zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT), 40)).toThrow(/cycle/iu);
    });
});

describe('buildDrawAxis', () => {
    const terms = Array.from({ length: HEAD_TERM_RANKS }, (_unused, rank) => `term${rank}`);
    const axis = buildDrawAxis('test', terms, 997, 617);

    it('fills the whole cycle, one slot per draw', () => {
        expect(axis.draw).toHaveLength(997);
    });

    it("gives each term exactly its apportioned share of the cycle's slots", () => {
        const expected = apportion(zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT), 997);
        const observed = new Map<string, number>();

        for (const term of axis.draw) {
            observed.set(term, (observed.get(term) ?? 0) + 1);
        }

        expect(terms.map((term) => observed.get(term) ?? 0)).toEqual([...expected]);
    });

    it('visits every slot exactly once across one stride cycle', () => {
        // The stride is what decorrelates two axes driven by the same row index; it can only do that if it
        // is a full permutation of the cycle, which needs `gcd(stride, cycle) = 1`.
        const visited = new Set(Array.from({ length: axis.cycle }, (_unused, index) => drawFrom(axis, index)));
        const drawn = Array.from({ length: axis.cycle }, (_unused, index) => drawFrom(axis, index));
        const perTerm = new Map<string, number>();

        for (const term of drawn) {
            perTerm.set(term, (perTerm.get(term) ?? 0) + 1);
        }

        expect(visited.size).toBe(HEAD_TERM_RANKS);
        expect([...perTerm.values()].reduce((total, count) => total + count, 0)).toBe(axis.cycle);
        expect(perTerm.get(terms[0]!)).toBe(axis.draw.filter((term) => term === terms[0]).length);
    });

    it('rejects a stride that shares a factor with the cycle', () => {
        expect(() => buildDrawAxis('test', terms, 1000, 500)).toThrow(/stride/iu);
    });

    it('rejects a term list whose length is not the declared rank count', () => {
        expect(() => buildDrawAxis('test', terms.slice(0, 5), 997, 617)).toThrow(/rank/iu);
    });
});

describe('drawFromSql', () => {
    const terms = Array.from({ length: HEAD_TERM_RANKS }, (_unused, rank) => `term${rank}`);
    const axis = buildDrawAxis('test', terms, 997, 617);

    it("renders the TypeScript draw's own arithmetic, against the same array", () => {
        // The SQL indexes the SAME expanded array the TypeScript indexes (bound as `$3`), so the two
        // renderings cannot disagree about which term a row gets — only about the arithmetic, which is
        // this one expression. `preparePerfFixture.ts`'s `assertRenderingsAgree` proves it against a real
        // Postgres; this pins the shape so a rewrite is visible in the diff.
        expect(drawFromSql(axis, 3, 's.i')).toBe('($3::text[])[(((s.i) * 617) % 997) + 1]');
    });
});

describe('assertDrawIndexFits', () => {
    it('accepts the SC-007 population', () => {
        expect(() =>
            assertDrawIndexFits(
                buildDrawAxis(
                    'test',
                    Array.from({ length: HEAD_TERM_RANKS }, (_u, r) => `t${r}`),
                    1013,
                    647,
                ),
                50_000,
            ),
        ).not.toThrow();
    });

    it('refuses a population whose strided index would overflow Postgres `integer`', () => {
        // `generate_series` yields `int4`, and the SQL mirror multiplies it by the stride BEFORE the
        // modulus. Past ~3.3M rows that product overflows and the seed dies mid-run with `integer out of
        // range` — a loud failure, but hours into a load-fixture seed rather than at the top of it.
        const axis = buildDrawAxis(
            'test',
            Array.from({ length: HEAD_TERM_RANKS }, (_u, r) => `t${r}`),
            1013,
            647,
        );

        expect(() => assertDrawIndexFits(axis, 2_147_483_647)).toThrow(/overflow/iu);
    });
});

describe('headTermRegime', () => {
    it('names the three regimes off the measured p50, not off magic numbers', () => {
        expect(headTermRegime(HEAD_TERM_SELECTIVITY_TAIL)).toBe('broad');
        expect(headTermRegime(2 * HEAD_TERM_SELECTIVITY_P50)).toBe('broad');
        expect(headTermRegime(2 * HEAD_TERM_SELECTIVITY_P50 - 1e-9)).toBe('typical');
        expect(headTermRegime(HEAD_TERM_SELECTIVITY_P50)).toBe('typical');
        expect(headTermRegime(HEAD_TERM_SELECTIVITY_P50 - 1e-9)).toBe('selective');
        expect(headTermRegime(0)).toBe('selective');
    });

    it('classifies every ladder rank into a declared regime', () => {
        const regimes = new Set(HEAD_TERM_REGIMES);

        for (const weight of zipfWeights(HEAD_TERM_RANKS, HEAD_TERM_ZIPF_EXPONENT)) {
            expect(regimes.has(headTermRegime(weight))).toBe(true);
        }
    });
});
