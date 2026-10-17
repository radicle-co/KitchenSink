/**
 * What the SC-007 load fixture actually GENERATES — the measurement instrument's own calibration (plan
 * U30, `specs/003-usda-food-data/tasks.md`).
 *
 * ## ⛔ Why this suite exists
 *
 * `FoodSearchDao.relevanceQuery` retrieves on the query's HEAD TERM (`rank_tokens @> ARRAY[head]`), so
 * the cost of a search tracks how many rows carry that one token. Before U30 the fixture built every name
 * by `index % list.length` over three tiny vocabularies, which made head-term selectivity **uniform** —
 * 4.35% on the ingredient axis, 9.09% on the cut axis, 5.88% on the brand axis, ratio 1.00x on all three.
 * The real 8,094-row USDA catalog is heavy-tailed: **1.89% at p50** with a worst realistic head term
 * (`ground beef` -> `beef`) at **13.75%**. The fixture was therefore wrong in both directions at once — it
 * charged a median query the tail's cost, which is why every probe shape tripled together when the
 * head-term branch landed, and it understated the worst case.
 *
 * An instrument that does not model the population is wrong whatever it reads, so these cases assert the
 * SHAPE of what the generator produces, not a latency. The latency question is answered by k6 afterwards,
 * against this corrected instrument.
 *
 * ## ⛔ The anti-vacuity rule
 *
 * A distribution assertion that passes on an empty or degenerate sample is worse than no assertion — this
 * repository has already had a verification report "ALL DATABASES MATCH" from ZERO relations, because the
 * comparison had no subjects. So every case below either counts subjects first or carries a non-zero floor
 * per regime, and every floor's failure message prints what was actually counted.
 */
import { describe, expect, it } from 'vitest';

import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import {
    HEAD_TERM_REGIMES,
    HEAD_TERM_REGIME_FLOOR,
    HEAD_TERM_SELECTIVITY_P50,
    HEAD_TERM_SELECTIVITY_TAIL,
    type HeadTermRegime,
    countHeadTermOccurrences,
    drawFrom,
    profileHeadTerms,
} from '../headTermSelectivity.js';
import {
    ALIAS_TERMS,
    HEAD_TERM_AXES,
    type PerfSearchProbes,
    PERF_RESOLVED_FOODS_DEFAULT,
    PREPARATIONS,
    SHAPE_HEAD_AXIS,
    buildSearchProbes,
    perfFoodName,
    perfNormalizedName,
} from '../perfFixture.js';

/** The SC-007 population, generated once — every case below reads the same corpus. */
const NAMES = Array.from({ length: PERF_RESOLVED_FOODS_DEFAULT }, (_unused, index) => perfFoodName('resolved', index));

/** Every folded token in that corpus, with the number of names carrying it. */
const TOKEN_COUNTS = countHeadTermOccurrences(NAMES);

/** The realized selectivity ladder per head axis. */
const PROFILES = Object.entries(HEAD_TERM_AXES).map(([name, axis]) =>
    profileHeadTerms(name, axis.terms, TOKEN_COUNTS, PERF_RESOLVED_FOODS_DEFAULT),
);

/** How far the realized ladder may sit from the catalog anchors before it stops modelling that catalog. */
const ANCHOR_TOLERANCE = 0.2;

/** The heavy-tail signature. The measured catalog's ratio is 13.75 / 1.89 = 7.3x; uniform is 1.0x. */
const MIN_TAIL_TO_P50_RATIO = 5;

describe('the generated head-term selectivity models the real catalog', () => {
    it('profiles a non-empty ladder for every head axis (anti-vacuity)', () => {
        // ⛔ Asserted FIRST. Every case below reads `PROFILES`; if the corpus were empty or the axes
        // unregistered, they would all compare empty sets and pass while proving nothing.
        expect(PROFILES.length).toBe(Object.keys(HEAD_TERM_AXES).length);
        expect(PROFILES.length).toBeGreaterThan(0);

        for (const profile of PROFILES) {
            expect(profile.terms.length, `axis '${profile.axis}' profiled ${profile.terms.length} head terms`).toBe(
                HEAD_TERM_AXES[profile.axis as keyof typeof HEAD_TERM_AXES]!.terms.length,
            );
            expect(profile.population).toBe(PERF_RESOLVED_FOODS_DEFAULT);
        }
    });

    it.each(Object.keys(HEAD_TERM_AXES))('puts the %s axis p50 on the measured catalog p50', (axisName) => {
        const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;

        expect(
            profile.p50,
            `axis '${axisName}' p50 selectivity is ${(profile.p50 * 100).toFixed(2)}%, ` +
                `catalog anchor ${(HEAD_TERM_SELECTIVITY_P50 * 100).toFixed(2)}%`,
        ).toBeGreaterThan(HEAD_TERM_SELECTIVITY_P50 * (1 - ANCHOR_TOLERANCE));
        expect(profile.p50).toBeLessThan(HEAD_TERM_SELECTIVITY_P50 * (1 + ANCHOR_TOLERANCE));
    });

    it.each(Object.keys(HEAD_TERM_AXES))('puts the %s axis worst case on the measured catalog tail', (axisName) => {
        const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;

        expect(
            profile.tail,
            `axis '${axisName}' worst head term '${profile.terms[0]?.term}' matches ` +
                `${(profile.tail * 100).toFixed(2)}% of rows, catalog anchor ` +
                `${(HEAD_TERM_SELECTIVITY_TAIL * 100).toFixed(2)}%`,
        ).toBeGreaterThan(HEAD_TERM_SELECTIVITY_TAIL * (1 - ANCHOR_TOLERANCE));
        expect(profile.tail).toBeLessThan(HEAD_TERM_SELECTIVITY_TAIL * (1 + ANCHOR_TOLERANCE));
    });

    it.each(Object.keys(HEAD_TERM_AXES))('makes the %s axis heavy-tailed rather than uniform', (axisName) => {
        // ⛔ THE mutation guard. Reverting the draw axes to `index % terms.length` puts every head term on
        // the same selectivity, so this ratio collapses to 1.00x — which is exactly the instrument U30 was
        // opened to replace. The p50 and tail cases above catch it too; this one names the defect.
        const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;

        expect(
            profile.tail / profile.p50,
            `axis '${axisName}' tail/p50 ratio is ${(profile.tail / profile.p50).toFixed(2)}x ` +
                `(uniform is 1.00x, the measured catalog is 7.28x)`,
        ).toBeGreaterThan(MIN_TAIL_TO_P50_RATIO);
    });

    it.each(Object.keys(HEAD_TERM_AXES))('leaves no %s head term unmatched by the corpus', (axisName) => {
        // A vocabulary word the corpus never contains is a probe that returns zero rows, which fails
        // `search.load.js`'s `expectHits` for the whole shape.
        const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;
        const absent = profile.terms.filter((term) => term.selectivity <= 0).map((term) => term.term);

        expect(absent, `axis '${axisName}' head terms with no rows: ${absent.join(', ') || '(none)'}`).toEqual([]);
    });
});

describe('every selectivity regime is represented (anti-vacuity)', () => {
    it.each(Object.keys(HEAD_TERM_AXES))('gives the %s axis a non-empty floor in each regime', (axisName) => {
        const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;
        const counted = HEAD_TERM_REGIMES.map((regime) => `${regime}=${profile.regimeCounts[regime]}`).join(' ');

        for (const regime of HEAD_TERM_REGIMES) {
            expect(
                profile.regimeCounts[regime],
                `axis '${axisName}' counted ${counted} across ${profile.terms.length} head terms; ` +
                    `regime '${regime}' is below the floor of ${HEAD_TERM_REGIME_FLOOR}`,
            ).toBeGreaterThanOrEqual(HEAD_TERM_REGIME_FLOOR);
        }
    });

    it.each([HEAD_TERM_REGIME_FLOOR, 32])('emits probes spanning every regime at a count of %i', (probeCount) => {
        const probes = buildSearchProbes(probeCount);
        const seen = new Map<string, Set<HeadTermRegime>>();
        let classified = 0;

        for (const [shape, axisName] of Object.entries(SHAPE_HEAD_AXIS)) {
            if (axisName === null) {
                continue;
            }

            const profile = PROFILES.find((candidate) => candidate.axis === axisName)!;
            const byTerm = new Map(profile.terms.map((term) => [term.term, term.regime]));
            const regimes = seen.get(axisName) ?? new Set<HeadTermRegime>();

            for (const probe of probes[shape as keyof typeof probes]) {
                const head = describeRankingQuery(probe).head;
                const regime = head === undefined ? undefined : byTerm.get(head);

                if (regime !== undefined) {
                    regimes.add(regime);
                    classified += 1;
                }
            }

            seen.set(axisName, regimes);
        }

        // Anti-vacuity: a probe set whose heads matched NO known term would leave every `seen` entry empty
        // and the coverage loop below would iterate over nothing.
        expect(
            classified,
            `classified ${classified} probe head terms at a probe count of ${probeCount}`,
        ).toBeGreaterThan(0);

        for (const [axisName, regimes] of seen) {
            expect(
                [...regimes].sort(),
                `axis '${axisName}' probes covered regimes [${[...regimes].sort().join(', ')}] ` +
                    `at a probe count of ${probeCount}`,
            ).toEqual([...HEAD_TERM_REGIMES].sort());
        }
    });
});

describe('the corpus SC-007 is measured against', () => {
    it('still reaches 50,000 distinct rows', () => {
        // `food_normalized_name_unique` silently drops a colliding row (`ON CONFLICT DO NOTHING`), so a name
        // template that lost its uniqueness discriminator would seed FEWER than 50,000 foods and SC-007
        // would be measured against a smaller store while reporting the same population.
        expect(PERF_RESOLVED_FOODS_DEFAULT).toBe(50_000);

        const normalized = new Set(
            Array.from({ length: PERF_RESOLVED_FOODS_DEFAULT }, (_unused, index) =>
                perfNormalizedName('resolved', index),
            ),
        );

        expect(normalized.size, `generated ${normalized.size} distinct normalized names`).toBe(
            PERF_RESOLVED_FOODS_DEFAULT,
        );
    });

    it('keeps the head axes statistically independent of one another', () => {
        // The three axes are driven by the SAME row index. If two of them shared a cycle — or ran without
        // the decorrelating stride — a row's ingredient would predict its cut, and the `phrase`/`narrow`
        // conjunctions would match a diagonal of the cross product instead of its interior. Measured, not
        // argued: a blocked expansion over two near-equal cycles reads ~6.7x its expected joint count.
        const axes = Object.values(HEAD_TERM_AXES);
        let compared = 0;
        let worst = 0;
        let worstLabel = '(none)';

        for (let left = 0; left < axes.length; left += 1) {
            for (let right = left + 1; right < axes.length; right += 1) {
                const joint = new Map<string, number>();
                const leftCounts = new Map<string, number>();
                const rightCounts = new Map<string, number>();

                for (let index = 0; index < PERF_RESOLVED_FOODS_DEFAULT; index += 1) {
                    const a = drawFrom(axes[left]!, index);
                    const b = drawFrom(axes[right]!, index);

                    joint.set(`${a}\u0000${b}`, (joint.get(`${a}\u0000${b}`) ?? 0) + 1);
                    leftCounts.set(a, (leftCounts.get(a) ?? 0) + 1);
                    rightCounts.set(b, (rightCounts.get(b) ?? 0) + 1);
                }

                for (const [pair, observed] of joint) {
                    const [a, b] = pair.split('\u0000') as [string, string];
                    const expected = (leftCounts.get(a)! * rightCounts.get(b)!) / PERF_RESOLVED_FOODS_DEFAULT;

                    if (expected < 30) {
                        continue;
                    }

                    compared += 1;

                    if (Math.abs(observed / expected - 1) > worst) {
                        worst = Math.abs(observed / expected - 1);
                        worstLabel =
                            `${axes[left]!.name}:${a} x ${axes[right]!.name}:${b} ` +
                            `observed ${observed}, expected ${expected.toFixed(1)}`;
                    }
                }
            }
        }

        expect(compared, `compared ${compared} axis-pair cells with an expected count of 30 or more`).toBeGreaterThan(
            100,
        );
        expect(worst, `worst joint deviation ${(worst * 100).toFixed(1)}% at ${worstLabel}`).toBeLessThan(0.5);
    });
});

describe('the probe set the k6 scenario rotates through', () => {
    const probes = buildSearchProbes(32);

    it('never emits a query the product would refuse to run (003-FR-010a)', () => {
        // A one- or two-character probe measures a request that never reaches the database. `search.load.js`
        // lost its `short` shape for that reason (plan U37); this asserts the same rule over the DATA, so a
        // vocabulary word shorter than the minimum cannot reintroduce it through the back door.
        const shapes = Object.keys(probes) as (keyof PerfSearchProbes)[];
        const tooShort = shapes.flatMap((shape) =>
            probes[shape].filter((value) => !meetsSearchMinimum(value)).map((value) => `${shape}:'${value}'`),
        );

        expect(shapes.length, `inspected ${shapes.length} probe shapes`).toBeGreaterThan(0);

        expect(
            tooShort,
            `probes below the ${MIN_SEARCH_QUERY_LENGTH}-character minimum: ${tooShort.join(', ') || '(none)'}`,
        ).toEqual([]);
    });

    it('names only terms the corpus can produce', () => {
        const heads = Object.entries(SHAPE_HEAD_AXIS)
            .filter(([, axisName]) => axisName !== null)
            .flatMap(([shape]) =>
                probes[shape as keyof typeof probes].map((probe) => describeRankingQuery(probe).head),
            );

        expect(heads.length).toBeGreaterThan(0);

        const unmatched = heads.filter((head) => head === undefined || (TOKEN_COUNTS.get(head) ?? 0) === 0);

        expect(unmatched, `probe head terms absent from the corpus: ${unmatched.join(', ') || '(none)'}`).toEqual([]);
    });
});

describe('the vocabularies stay disjoint', () => {
    it('shares no folded token between any two axes', () => {
        // The alias probe is a two-lexeme AND that must be satisfiable ONLY through
        // `aliases_search_vector`, and a head term must name exactly one axis. A word appearing on two
        // axes breaks both at once, silently.
        const lists: Record<string, readonly string[]> = {
            preparation: PREPARATIONS,
            alias: ALIAS_TERMS,
            ...Object.fromEntries(Object.entries(HEAD_TERM_AXES).map(([name, axis]) => [name, axis.terms])),
        };
        const owners = new Map<string, string>();
        const clashes: string[] = [];

        for (const [listName, terms] of Object.entries(lists)) {
            for (const term of terms) {
                const folded = describeRankingQuery(term).head!;
                const owner = owners.get(folded);

                if (owner !== undefined) {
                    clashes.push(`'${folded}' in both ${owner} and ${listName}`);
                }

                owners.set(folded, listName);
            }
        }

        expect(
            owners.size,
            `folded ${owners.size} vocabulary terms across ${Object.keys(lists).length} lists`,
        ).toBeGreaterThan(0);
        expect(clashes, clashes.join('; ') || 'no clashes').toEqual([]);
    });
});
