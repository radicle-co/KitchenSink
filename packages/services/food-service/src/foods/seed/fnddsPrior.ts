/**
 * The FNDDS/WWEIA consumption-prior DERIVATION (plan U5, KTD-G) — pure. The operator-run seed command
 * (`seed:fndds-prior`) parses the operator-downloaded files and hands their rows here; nothing in this
 * module (or anywhere deployed) fetches USDA or CDC.
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
 * Normalize a raw consumption weight into the stored [0, 1] fraction.
 *
 * @param weight - The raw survey-weighted consumption weight.
 * @returns `min(1, ln(1 + weight) / ln(1 + ceiling))`. Pure.
 */
export function normalizePriorFraction(weight: number): number {
    if (weight <= 0) {
        return 0;
    }

    return Math.min(1, Math.log1p(weight) / Math.log1p(PRIOR_WEIGHT_CEILING));
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
