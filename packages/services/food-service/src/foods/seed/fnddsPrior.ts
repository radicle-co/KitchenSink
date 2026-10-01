/**
 * The FNDDS/WWEIA consumption-prior DERIVATION (plan U5, KTD-G) — pure. The operator-run command
 * (`seed:fndds-prior`) parses the pinned, operator-downloaded files and hands their rows here; nothing in this
 * module (or anywhere deployed) fetches USDA or CDC.
 *
 * Its output is the committed `data/foodPopularity.jsonl` (curated seed plan U1, R45): one RAW weight per SR
 * Legacy item, so every stage ranks search the same way. Only raw weights are stored, because an item's
 * weight is the SUM of its source rows' weights and log-normalized fractions do not sum; the seed image derives
 * each fraction with {@link normalizePriorFraction}.
 *
 * ## What the 2026-08-31 spike measured, and how it shaped this module
 *
 * Run on FNDDS 2021-2023 (FDC `survey_food` 2024-10-31) + NHANES August 2021–August 2023 day-1 intake
 * (`DR1IFF_L`, weighted by `WTDRD1`):
 *
 *  1. **The post-2019 "weakened linkage" is 8-digit FNDDS food codes inside `input_food.sr_code`.** The
 *     plan warned the food-level crosswalk no longer exists in the naive-join shape; concretely, 548 of
 *     2,017 weight-receiving codes were FNDDS-internal. Resolving them RECURSIVELY through that survey
 *     food's own decomposition ({@link deriveSrPriors}) moves SR-Legacy weight coverage from 72.8% to
 *     **95.3%**; the residual 4.4% sits on post-SR-Legacy NDBs (e.g. `Oil, olive, extra virgin`, NDB 4063)
 *     our frozen SR Legacy catalog does not hold, and 0.3% is undecomposable.
 *  2. **Weights span ~1e3 .. 4.6e8** (tap water), so the fraction is LOG-normalized — and against a FIXED
 *     reference ceiling ({@link PRIOR_WEIGHT_CEILING}), not the observed max: a re-seed on a new NHANES
 *     cycle must not silently re-scale every stored fraction.
 *  3. **Three of the 14 canonical staples are structurally unreachable** and are carried as NAMED
 *     exceptions on {@link STAPLE_EXPECTATIONS} (amending the plan's blanket gate, on measurement):
 *     vanilla extract (NDB 2050) and mace (NDB 2022) appear ZERO times as FNDDS ingredients, and olive
 *     oil's survey food decomposes only to post-SR-Legacy NDBs. All three already rank correctly without a
 *     prior (the U4 probe), so the gate the plan wanted — "the seed fails loudly precisely on the rows the
 *     prior exists to fix" — is kept for every row it CAN cover and stated out loud for the rest.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

import { fdcIdOf, fdcKey, isFdcKey, type FdcKey } from './catalogKey.js';
import { SeedRefusedError } from './catalog/curatedSeedFormat.errors.js';

/** One `survey_fndds_food.csv` row, narrowed. */
export interface SurveyFoodRow {
    readonly fdcId: string;
    readonly foodCode: string;
}

/** One `input_food.csv` row, narrowed. `srCode` may be an SR NDB number OR an 8-digit FNDDS food code. */
export interface InputFoodRow {
    readonly surveyFdcId: string;
    readonly srCode: string;
    readonly gramWeight: number;
}

/** One consumption-frequency row: an FNDDS food code and its survey-weighted intake weight. */
export interface IntakeRow {
    readonly foodCode: string;
    readonly weight: number;
}

/** Everything the derivation consumes. */
export interface PriorDerivationInput {
    readonly surveyFoods: readonly SurveyFoodRow[];
    readonly inputFoods: readonly InputFoodRow[];
    readonly intake: readonly IntakeRow[];
}

/**
 * The fixed reference ceiling the log normalization divides by — chosen just above the most consumed item
 * in the 2021-2023 cycle (tap water, 4.63e8), so today's maximum lands near 1 and a future cycle's larger
 * survey does not silently deflate every other food's fraction.
 */
export const PRIOR_WEIGHT_CEILING = 5e8;

/** How deep the 8-digit-code recursion may go. The spike needed 2; 6 bounds a pathological cycle. */
const MAX_DECOMPOSITION_DEPTH = 6;

/**
 * Distribute each consumed food code's weight onto SR codes by gram share, resolving FNDDS-internal
 * 8-digit codes through their own decompositions.
 *
 * @param input - The parsed file rows.
 * @returns Total consumption weight per SR code. Pure.
 */
export function deriveSrPriors(input: PriorDerivationInput): ReadonlyMap<string, number> {
    const fdcByCode = new Map(input.surveyFoods.map((row) => [row.foodCode, row.fdcId]));
    const partsByFdc = new Map<string, InputFoodRow[]>();

    for (const row of input.inputFoods) {
        const bucket = partsByFdc.get(row.surveyFdcId) ?? [];
        bucket.push(row);
        partsByFdc.set(row.surveyFdcId, bucket);
    }

    function srShares(fdcId: string, depth: number): readonly (readonly [string, number])[] {
        if (depth > MAX_DECOMPOSITION_DEPTH) {
            return [];
        }

        const parts = partsByFdc.get(fdcId) ?? [];
        const total = parts.reduce((sum, part) => sum + Math.max(part.gramWeight, 0), 0);

        if (total <= 0) {
            return [];
        }

        const shares: (readonly [string, number])[] = [];

        for (const part of parts) {
            const fraction = Math.max(part.gramWeight, 0) / total;
            const asSurveyFdc = part.srCode.length === 8 ? fdcByCode.get(part.srCode) : undefined;

            if (asSurveyFdc !== undefined) {
                for (const [sr, sub] of srShares(asSurveyFdc, depth + 1)) {
                    shares.push([sr, fraction * sub]);
                }
            } else {
                shares.push([part.srCode, fraction]);
            }
        }

        return shares;
    }

    const weights = new Map<string, number>();

    for (const row of input.intake) {
        const fdcId = fdcByCode.get(row.foodCode);

        if (fdcId === undefined) {
            continue;
        }

        for (const [sr, fraction] of srShares(fdcId, 0)) {
            weights.set(sr, (weights.get(sr) ?? 0) + row.weight * fraction);
        }
    }

    return weights;
}

/**
 * Weight arithmetic. Every finite double's shortest text has at most 17 significant digits between 1e-324 and 1e308,
 * so a sum of them needs at most about 650 digits: at this precision `plus` never rounds, and the sum is exact.
 */
const ExactDecimal = Decimal.clone({ precision: 1000 });

/**
 * Logarithm arithmetic: 40 significant digits, so rounding the quotient to {@link PRIOR_FRACTION_PLACES} places
 * differs from the exact value only within 1e-40 of a tie.
 */
const LogDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** The places a stored prior fraction keeps (curated plan U5). Changing it moves every popularity row. */
export const PRIOR_FRACTION_PLACES = 9;

/**
 * An item's raw weight: the exact sum of its source rows' committed weights (R45). Pure.
 *
 * Each weight's committed text is `String(weight)`, because `parsePopularityJsonl` accepts only the canonical
 * `JSON.stringify` rendering, so the sum is of the text the file holds, never of binary floats.
 *
 * @param weights - The source rows' weights.
 * @returns The sum as a plain decimal string, `'0'` for none.
 */
export function sumPopularityWeights(weights: readonly number[]): string {
    return weights.reduce((sum, weight) => sum.plus(String(weight)), new ExactDecimal(0)).toFixed();
}

/**
 * Normalize a raw consumption weight into the stored [0, 1] fraction. Pure.
 *
 * `decimal.js`, never `Math.log1p`, so the verifier's SQL `numeric` can reproduce it: `round(ln(1 + w) / ln(1 +
 * ceiling), 9)`, rounded half away from zero as SQL's `round()` does.
 *
 * @param weight - The raw weight as a decimal string.
 * @returns `min(1, ln(1 + weight) / ln(1 + ceiling))` rounded to {@link PRIOR_FRACTION_PLACES} places, as a plain
 *   decimal string; `'0'` for a weight of zero or less.
 */
export function normalizePriorFraction(weight: string): string {
    const value = new LogDecimal(weight);

    if (value.lessThanOrEqualTo(0)) {
        return '0';
    }

    const fraction = LogDecimal.min(1, value.plus(1).ln().dividedBy(new LogDecimal(PRIOR_WEIGHT_CEILING).plus(1).ln()));

    return fraction.toDecimalPlaces(PRIOR_FRACTION_PLACES, Decimal.ROUND_HALF_UP).toFixed();
}

/** One canonical staple row the acceptance gate checks, or excuses with a MEASURED reason. */
export interface StapleExpectation {
    readonly query: string;
    /** The canonical SR Legacy NDB number the U4 probe's staple set names. */
    readonly ndb: string;
    /** Present ONLY for a staple the spike measured as structurally unreachable, with the reason. */
    readonly exception?: string;
}

/** The 14-query staple set (plan U5), with the spike's three measured exceptions. */
export const STAPLE_EXPECTATIONS: readonly StapleExpectation[] = [
    { query: 'flour', ndb: '20081' },
    { query: 'sugar', ndb: '19335' },
    { query: 'salt', ndb: '2047' },
    { query: 'butter', ndb: '1001' },
    { query: 'milk', ndb: '1077' },
    { query: 'egg', ndb: '1123' },
    { query: 'cinnamon', ndb: '2010' },
    { query: 'pepper', ndb: '2030' },
    { query: 'rum', ndb: '14037' },
    { query: 'bran', ndb: '20077' },
    { query: 'onion', ndb: '11282' },
    {
        query: 'vanilla',
        ndb: '2050',
        exception: 'Vanilla extract appears zero times as an FNDDS 2021-2023 ingredient (measured 2026-08-31).',
    },
    {
        query: 'mace',
        ndb: '2022',
        exception: 'Mace appears zero times as an FNDDS 2021-2023 ingredient (measured 2026-08-31).',
    },
    {
        query: 'olive oil',
        ndb: '4053',
        exception:
            "Olive oil's FNDDS survey food decomposes only to post-SR Legacy NDBs (4063, 100258) absent from the frozen 2018-04 catalog.",
    },
];

/** The gate's verdict: pass, or the named rows that make the seed fail loudly. */
export interface StapleGateVerdict {
    readonly ok: boolean;
    /** The coverable staples that received no prior — `query (NDB n)` each, for the error message. */
    readonly missing: readonly string[];
}

/**
 * The LOUD acceptance gate: every staple the files CAN cover must have received a prior.
 *
 * @param srWeights - The derived weight per SR code.
 * @returns The verdict. Pure.
 */
export function evaluateStapleGate(srWeights: ReadonlyMap<string, number>): StapleGateVerdict {
    const missing = STAPLE_EXPECTATIONS.filter(
        (staple) => staple.exception === undefined && !((srWeights.get(staple.ndb) ?? 0) > 0),
    ).map((staple) => `${staple.query} (NDB ${staple.ndb})`);

    return { ok: missing.length === 0, missing };
}

/**
 * Key each crosswalked SR code's weight by its FDC item, exactly the rows the retired database writer
 * upserted: an SR code with no `sr_legacy_food.csv` row (a post-SR-Legacy NDB) is not written. Pure.
 *
 * @param srWeights - The derived weight per SR NDB code.
 * @param fdcByNdb - `sr_legacy_food.csv`'s NDB number → FDC id crosswalk.
 * @returns The weight per item key.
 * @throws {RangeError} when two NDB codes crosswalk to one item, which would drop a weight silently.
 */
export function popularityWeightsByItem(
    srWeights: ReadonlyMap<string, number>,
    fdcByNdb: ReadonlyMap<string, string>,
): ReadonlyMap<FdcKey, number> {
    const weights = new Map<FdcKey, number>();

    for (const [ndb, weight] of srWeights) {
        const fdcId = fdcByNdb.get(ndb);

        if (fdcId === undefined) {
            continue;
        }

        const item = fdcKey(/^[1-9][0-9]*$/.test(fdcId) ? Number(fdcId) : Number.NaN);

        if (weights.has(item)) {
            throw new RangeError(`Two SR Legacy NDB numbers crosswalk to ${item}.`);
        }

        weights.set(item, weight);
    }

    return weights;
}

/**
 * Render one popularity line. Pure.
 *
 * @param item - The item key.
 * @param weight - Its raw weight.
 * @returns The canonical line, without its newline.
 */
function renderPopularityLine(item: FdcKey, weight: number): string {
    return JSON.stringify({ item, weight });
}

/**
 * Render `foodPopularity.jsonl`: `{"item":"fdc:N","weight":W}` per line, sorted by numeric FDC id. Pure.
 *
 * @param weights - The weight per item key.
 * @returns The file's text.
 */
export function renderPopularityJsonl(weights: ReadonlyMap<FdcKey, number>): string {
    return [...weights]
        .sort(([left], [right]) => fdcIdOf(left) - fdcIdOf(right))
        .map(([item, weight]) => `${renderPopularityLine(item, weight)}\n`)
        .join('');
}

const POPULARITY_FILE = 'foodPopularity.jsonl';

const popularityLineSchema = z.strictObject({
    item: z.custom<FdcKey>(isFdcKey, { message: 'must be an fdc:<id> key' }),
    weight: z.number().nonnegative(),
});

/**
 * Parse the committed `foodPopularity.jsonl`. Every line must be the canonical rendering, in ascending FDC id
 * order, so the parse accepts exactly the bytes {@link renderPopularityJsonl} writes. Pure.
 *
 * @param text - The file's text.
 * @returns The weight per item key.
 * @throws {SeedRefusedError} naming the first line that is not canonical.
 */
export function parsePopularityJsonl(text: string): ReadonlyMap<FdcKey, number> {
    const weights = new Map<FdcKey, number>();
    const lines = text === '' ? [] : text.split('\n');
    const refusal = (line: number, detail: string): SeedRefusedError =>
        new SeedRefusedError([{ where: `${POPULARITY_FILE}:${String(line)}`, rule: 'malformedRecord', detail }]);

    if (lines.length > 0 && lines.at(-1) !== '') {
        throw refusal(lines.length, 'does not end in a newline');
    }

    let previous = 0;

    for (const [index, line] of lines.slice(0, -1).entries()) {
        let value: unknown;

        try {
            value = JSON.parse(line);
        } catch (error) {
            throw refusal(index + 1, `is not JSON (${String(error)})`);
        }

        const parsed = popularityLineSchema.safeParse(value);

        if (!parsed.success) {
            throw refusal(index + 1, parsed.error.issues.map((issue) => issue.message).join('; '));
        }

        const { item, weight } = parsed.data;

        if (renderPopularityLine(item, weight) !== line) {
            throw refusal(index + 1, 'is not the canonical rendering');
        }

        if (fdcIdOf(item) <= previous) {
            throw refusal(index + 1, `${item} is out of order or repeated`);
        }

        previous = fdcIdOf(item);
        weights.set(item, weight);
    }

    return weights;
}
