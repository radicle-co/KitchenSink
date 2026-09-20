/**
 * The head-term selectivity LADDER — how often each vocabulary word appears in the SC-007 load corpus,
 * and the weighted draw axis that realizes it in TypeScript and in SQL at once (plan U30).
 *
 * DESIGN PATTERN: **Value object + Builder.** {@link buildDrawAxis} is a pure builder that turns a
 * declared term list, a cycle and a stride into an immutable {@link DrawAxis}; {@link drawFrom} and
 * {@link drawFromSql} are the axis's two renderings, and they index the SAME expanded array, so the pair
 * cannot disagree about which term a row gets. The axis is also the Strategy `perfFixture.ts`'s name and
 * description renderers dispatch through, which is what lets a fourth axis be added without touching them.
 *
 * ## ⛔ Why a weighted draw exists at all
 *
 * `FoodSearchDao.relevanceQuery` retrieves on the query's HEAD TERM — `rank_tokens @> ARRAY[head]` — so
 * the cost of a search tracks how many rows carry that ONE token. Before U30 the fixture picked every
 * word by `index % list.length`, which made head-term selectivity **uniform**: every ingredient matched
 * 4.35% of rows, every cut 9.09%, every brand 5.88%. The real 8,094-row USDA catalog is heavy-tailed —
 * **1.89% at p50**, worst realistic term (`ground beef` → `beef`) **13.75%** — so the fixture was wrong
 * in both directions at once. It charged a median query the tail's cost (which is why every probe shape
 * tripled together when the head-term branch landed, rather than a subset) and it understated the worst
 * case, where at 50,000 rows a real query scans ~6,875 rows against the fixture's 4,545.
 *
 * The ladder here is a **Zipf** distribution, which is not a curve chosen to fit: term frequency in a
 * natural-language catalog is the textbook Zipf case, and solving its two free parameters against the two
 * measured anchors lands both simultaneously (see {@link HEAD_TERM_RANKS}).
 *
 * ## ⛔ Why the stride is load-bearing
 *
 * All three head axes are driven by the SAME row index. Expanding a ladder into contiguous blocks and
 * reading it at `index % cycle` correlates two axes whose cycles are close together — measured, the joint
 * count of (broadest ingredient x broadest cut) comes out ~6.7x its independent expectation, because
 * `i % 997` and `i % 1009` both stay small at the same `i`. Multiplying the index by an axis-specific
 * stride first (a full permutation of the cycle, since the cycles are prime) breaks that alignment, and
 * `perfFixtureDistribution.test.ts` asserts the result rather than trusting the argument.
 */
import { rankingTokens } from '@kitchensink/recipe-core/resolution/ranking-terms';

/**
 * Head-term selectivity at the median, measured 2026-08-25 against the real 8,094-row USDA catalog.
 * Also the boundary between the `typical` and `selective` regimes.
 */
export const HEAD_TERM_SELECTIVITY_P50 = 0.0189;

/** The worst realistic head term's selectivity in that same catalog (`ground beef` → `beef`). */
export const HEAD_TERM_SELECTIVITY_TAIL = 0.1375;

/**
 * How many distinct words each head-bearing vocabulary carries.
 *
 * ⚠️ Not a free choice, and not a round number for its own sake. Every row draws exactly ONE word per
 * axis, so the axis's weights sum to 1 and its MEAN selectivity is `1 / HEAD_TERM_RANKS`. Pinning the
 * maximum at {@link HEAD_TERM_SELECTIVITY_TAIL} and the median at {@link HEAD_TERM_SELECTIVITY_P50} then
 * fixes both the rank count and the exponent: 36 and 0.68 is the pair that minimises the error against
 * both anchors at once (realized max **13.68%**, realized p50 **1.88%**, realized floor **1.20%**).
 *
 * The old 23 ingredients / 11 cuts / 17 brands could not carry this shape at ANY exponent — with 11 cuts
 * the mean is already 9.09%, so a 1.89% median would require the top six words to sum to more than six
 * times the permitted maximum.
 */
export const HEAD_TERM_RANKS = 36;

/** The Zipf exponent solved against both anchors at {@link HEAD_TERM_RANKS}. */
export const HEAD_TERM_ZIPF_EXPONENT = 0.68;

/**
 * The selectivity bands a head term can fall in, ordered broadest first.
 *
 * Anchored on the MEASURED p50 rather than on invented thresholds: `broad` is at least twice the catalog
 * median (the queries whose cost SC-007 is really about), `typical` is the band the median sits in, and
 * `selective` is everything below it. A generator that collapses to a single selectivity leaves two of
 * the three empty, which is what the anti-vacuity floor detects.
 */
export const HEAD_TERM_REGIMES = ['broad', 'typical', 'selective'] as const;

/** One of {@link HEAD_TERM_REGIMES}. */
export type HeadTermRegime = (typeof HEAD_TERM_REGIMES)[number];

/**
 * The smallest number of head terms a regime may hold before the corpus stops exercising it.
 *
 * Three, not one: a single term in a band is indistinguishable from a boundary accident, and the designed
 * ladder puts 6 / 12 / 18 terms in the three regimes, so this is a floor rather than a change-detector.
 */
export const HEAD_TERM_REGIME_FLOOR = 3;

/**
 * Which band a selectivity falls in. Pure.
 *
 * @param selectivity - Fraction of the corpus a head term matches, in `[0, 1]`.
 * @returns The regime.
 */
export function headTermRegime(selectivity: number): HeadTermRegime {
    if (selectivity >= 2 * HEAD_TERM_SELECTIVITY_P50) {
        return 'broad';
    }

    return selectivity >= HEAD_TERM_SELECTIVITY_P50 ? 'typical' : 'selective';
}

/**
 * The normalized Zipf ladder for a vocabulary — rank 1 first, summing to exactly 1. Pure.
 *
 * @param ranks - How many words the vocabulary carries.
 * @param exponent - The Zipf exponent; larger is more top-heavy.
 * @returns The weight per rank, strictly decreasing.
 * @throws When the vocabulary is too small to carry the measured catalog's shape.
 */
export function zipfWeights(ranks: number, exponent: number): readonly number[] {
    // ⛔ The weights sum to 1, which BOUNDS the rank count from both sides and is why 23 ingredients could
    // never have carried this shape. Too few ranks: even at the extremes — every rank above the median at
    // the tail value, every rank at or below it at the p50 value — the ladder cannot reach 1. Too many:
    // the mean falls below the p50, and a decreasing ladder's median never exceeds its mean.
    const ceiling =
        Math.floor(ranks / 2) * HEAD_TERM_SELECTIVITY_TAIL + Math.ceil(ranks / 2) * HEAD_TERM_SELECTIVITY_P50;

    if (ceiling < 1 || 1 / ranks < HEAD_TERM_SELECTIVITY_P50) {
        throw new Error(
            `head-term ladder: ${ranks} ranks cannot carry a p50 of ${HEAD_TERM_SELECTIVITY_P50} with a tail ` +
                `of ${HEAD_TERM_SELECTIVITY_TAIL} — mean weight ${(1 / ranks).toFixed(4)}, ` +
                `reachable total ${ceiling.toFixed(3)}.`,
        );
    }

    const raw = Array.from({ length: ranks }, (_unused, rank) => (rank + 1) ** -exponent);
    const total = raw.reduce((sum, weight) => sum + weight, 0);

    return raw.map((weight) => weight / total);
}

/**
 * Apportion a cycle's slots across a ladder by largest remainder, so the integer counts sum to exactly
 * the cycle and each rank keeps its share as closely as integers allow. Pure.
 *
 * ⛔ Largest remainder rather than `Math.round`: rounding each rank independently does not sum to the
 * cycle, and a draw table shorter or longer than its modulus silently re-weights the whole ladder.
 *
 * @param weights - A normalized ladder, decreasing.
 * @param cycle - How many slots to distribute.
 * @returns One integer count per rank, summing to `cycle`.
 * @throws When the cycle is too small to give every rank at least one slot.
 */
export function apportion(weights: readonly number[], cycle: number): readonly number[] {
    const exact = weights.map((weight) => weight * cycle);
    const counts = exact.map((value) => Math.floor(value));
    const remainders = exact
        .map((value, rank) => ({ rank, remainder: value - Math.floor(value) }))
        .sort((left, right) => right.remainder - left.remainder || left.rank - right.rank);

    let shortfall = cycle - counts.reduce((sum, count) => sum + count, 0);

    for (const { rank } of remainders) {
        if (shortfall <= 0) {
            break;
        }

        counts[rank] = counts[rank]! + 1;
        shortfall -= 1;
    }

    const empty = counts.filter((count) => count < 1).length;

    // ⛔ A rank with zero slots is a vocabulary word the corpus never contains, so its search probe returns
    // no rows and `search.load.js`'s `expectHits` fails the entire shape.
    if (empty > 0) {
        throw new Error(
            `head-term ladder: a cycle of ${cycle} leaves ${empty} of ${weights.length} ranks with no ` +
                `occurrence; the corpus would carry no row for those words.`,
        );
    }

    return counts;
}

/** A vocabulary axis plus the weighted, strided table a row index draws its word from. */
export interface DrawAxis {
    /** Axis name, used in failure messages and as the key in `perfFixture.ts`'s axis register. */
    readonly name: string;
    /** The vocabulary, ordered by DESIGNED selectivity — broadest first. Reordering re-weights the axis. */
    readonly terms: readonly string[];
    /** The draw table's modulus. Prime, and distinct per axis, so two axes are never one function of `i`. */
    readonly cycle: number;
    /** The multiplier applied to the row index before the modulus — see the module doc. */
    readonly stride: number;
    /** `cycle` slots, each holding the term drawn there. Bound verbatim as the SQL side's `text[]`. */
    readonly draw: readonly string[];
}

/** Greatest common divisor, for the stride/cycle coprimality guard. Pure. */
function gcd(left: number, right: number): number {
    return right === 0 ? left : gcd(right, left % right);
}

/**
 * Build a weighted draw axis. Pure.
 *
 * @param name - Axis name.
 * @param terms - The vocabulary, broadest first; must hold exactly {@link HEAD_TERM_RANKS} words.
 * @param cycle - The draw table's modulus.
 * @param stride - The index multiplier; must be coprime to `cycle`.
 * @returns The axis.
 * @throws When the vocabulary is the wrong size or the stride is not a full permutation of the cycle.
 */
export function buildDrawAxis(name: string, terms: readonly string[], cycle: number, stride: number): DrawAxis {
    if (terms.length !== HEAD_TERM_RANKS) {
        throw new Error(
            `draw axis '${name}': ${terms.length} terms, but the ladder is defined for ` +
                `${HEAD_TERM_RANKS} ranks — a mismatch silently truncates or re-weights the axis.`,
        );
    }

    if (gcd(stride, cycle) !== 1) {
        throw new Error(
            `draw axis '${name}': stride ${stride} shares a factor with cycle ${cycle}, so it visits only ` +
                `${cycle / gcd(stride, cycle)} of the ${cycle} slots and most of the vocabulary never appears.`,
        );
    }

    const counts = apportion(zipfWeights(terms.length, HEAD_TERM_ZIPF_EXPONENT), cycle);
    const draw = counts.flatMap((count, rank) => Array.from({ length: count }, () => terms[rank]!));

    return { name, terms, cycle, stride, draw };
}

/**
 * The term a row index draws from an axis. Pure — and the exact arithmetic {@link drawFromSql} renders.
 *
 * @param axis - The axis.
 * @param index - Zero-based row index.
 * @returns The drawn term.
 */
export function drawFrom(axis: DrawAxis, index: number): string {
    return axis.draw[(index * axis.stride) % axis.cycle]!;
}

/**
 * The SQL expression rendering {@link drawFrom} for a `generate_series` column.
 *
 * @param axis - The axis; its `draw` array is what must be bound at `param`.
 * @param param - 1-based placeholder number holding `axis.draw` as `text[]`.
 * @param expression - The SQL integer expression holding the row index.
 * @returns A SQL scalar expression producing the drawn term.
 */
export function drawFromSql(axis: DrawAxis, param: number, expression: string): string {
    return `($${param}::text[])[(((${expression}) * ${axis.stride}) % ${axis.cycle}) + 1]`;
}

/** Largest value `int4` holds — `generate_series` yields `int4`, and the SQL mirror multiplies it. */
const POSTGRES_INT4_MAX = 2_147_483_647;

/**
 * Refuse a population whose strided index would overflow Postgres' `integer`.
 *
 * ⛔ Checked before the seed rather than discovered during it: `generate_series` yields `int4` and
 * {@link drawFromSql} multiplies by the stride BEFORE taking the modulus, so past roughly 3.3M rows the
 * product raises `integer out of range` — hours into a load-fixture seed instead of at the top of one.
 *
 * @param axis - The axis about to be rendered.
 * @param population - The highest row count the rendering will be asked for.
 * @throws When the product would overflow.
 */
export function assertDrawIndexFits(axis: DrawAxis, population: number): void {
    if ((population - 1) * axis.stride > POSTGRES_INT4_MAX) {
        throw new Error(
            `draw axis '${axis.name}': ${population} rows x stride ${axis.stride} overflows Postgres ` +
                `integer (${POSTGRES_INT4_MAX}); the seed would die mid-run with 'integer out of range'.`,
        );
    }
}

/**
 * Count how many of the given names carry each folded ranking token. Pure.
 *
 * Folded through `rankingTokens` — the SAME rule `food.rank_tokens` is generated by and
 * `describeRankingQuery` derives a head from — so a count here IS the number of rows the head-term branch
 * would retrieve. Counting DISTINCT tokens per name, because `rank_tokens @> ARRAY[head]` is containment:
 * a name repeating a word still matches once.
 *
 * @param names - The corpus.
 * @returns Token to the number of names carrying it.
 */
export function countHeadTermOccurrences(names: Iterable<string>): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();

    for (const name of names) {
        for (const token of new Set(rankingTokens(name))) {
            counts.set(token, (counts.get(token) ?? 0) + 1);
        }
    }

    return counts;
}

/** One head term's realized share of the corpus. */
export interface HeadTermSelectivity {
    /** The folded token, as the head-term branch would bind it. */
    readonly term: string;
    /** Fraction of the corpus carrying it. */
    readonly selectivity: number;
    /** Which band that falls in. */
    readonly regime: HeadTermRegime;
}

/** An axis's realized selectivity ladder, as generated rather than as designed. */
export interface SelectivityProfile {
    /** The axis this profiles. */
    readonly axis: string;
    /** How many rows it was measured over. */
    readonly population: number;
    /** Every head term, most selective-costly first. */
    readonly terms: readonly HeadTermSelectivity[];
    /** The broadest term's selectivity — the worst case SC-007's p95 is driven by. */
    readonly tail: number;
    /** The median term's selectivity — the anchor the catalog was measured at. */
    readonly p50: number;
    /** The narrowest term's selectivity. Zero means a probe that can never return a row. */
    readonly floor: number;
    /** How many terms fall in each regime. */
    readonly regimeCounts: Readonly<Record<HeadTermRegime, number>>;
}

/**
 * Profile an axis's REALIZED head-term selectivity against a counted corpus. Pure.
 *
 * ⚠️ Measured from the generated names, not from the declared ladder. A correct ladder wired into a name
 * template that ignores it would profile perfectly against its own weights and still generate a uniform
 * corpus; the only honest subject is what came out.
 *
 * @param axis - Axis name, for failure messages.
 * @param terms - The axis vocabulary.
 * @param counts - Token counts from {@link countHeadTermOccurrences}.
 * @param population - How many names those counts came from.
 * @returns The profile.
 */
export function profileHeadTerms(
    axis: string,
    terms: readonly string[],
    counts: ReadonlyMap<string, number>,
    population: number,
): SelectivityProfile {
    const measured = terms
        .map((term) => {
            const folded = rankingTokens(term)[0] ?? term;
            const selectivity = (counts.get(folded) ?? 0) / population;

            return { term: folded, selectivity, regime: headTermRegime(selectivity) };
        })
        .sort((left, right) => right.selectivity - left.selectivity);

    const regimeCounts = Object.fromEntries(
        HEAD_TERM_REGIMES.map((regime) => [regime, measured.filter((entry) => entry.regime === regime).length]),
    ) as Record<HeadTermRegime, number>;

    const middle = measured.length / 2;
    const p50 =
        measured.length % 2 === 1
            ? measured[Math.floor(middle)]!.selectivity
            : (measured[middle - 1]!.selectivity + measured[middle]!.selectivity) / 2;

    return {
        axis,
        population,
        terms: measured,
        tail: measured[0]?.selectivity ?? 0,
        p50,
        floor: measured.at(-1)?.selectivity ?? 0,
        regimeCounts,
    };
}
