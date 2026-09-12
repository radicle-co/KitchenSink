/**
 * The FNDDS/WWEIA prior DERIVATION (plan U5) — pure, exercised on miniature file shapes.
 *
 * The spike (2026-08-31, FNDDS 2021-2023 + NHANES 2021-2023 day 1) fixed three facts these cases pin:
 *
 *  1. The post-2019 "weakened linkage" manifests as 8-digit FNDDS food codes INSIDE `input_food.sr_code`
 *     — resolving them recursively moves SR-Legacy weight coverage from 72.8% to 95.3%.
 *  2. Consumption weights span ~1e3..4.6e8 (tap water), so the fraction is LOG-normalized against a fixed
 *     reference ceiling rather than the observed max — a re-seed on a new cycle must not silently re-scale
 *     every stored fraction.
 *  3. Three of the 14 canonical staples are STRUCTURALLY unreachable (vanilla extract and mace never
 *     appear as FNDDS ingredients; olive oil decomposes only to post-SR-Legacy NDBs), so the acceptance
 *     gate carries a NAMED exceptions list rather than a blanket "every staple got a prior".
 *
 * The prior is no longer written to a database: the generator writes the committed `foodPopularity.jsonl`
 * (curated seed plan U1, R45), one raw weight per SR item, and the seed derives each fraction from the SUM of
 * an item's source weights. The expected weights below are computed by hand, not re-derived by the code under
 * test.
 */
import { describe, expect, it } from 'vitest';

import { isSeedRefusedError } from '../catalog/curatedSeedFormat.errors.js';
import {
    PRIOR_WEIGHT_CEILING,
    STAPLE_EXPECTATIONS,
    deriveSrPriors,
    evaluateStapleGate,
    normalizePriorFraction,
    parsePopularityJsonl,
    popularityWeightsByItem,
    renderPopularityJsonl,
    sumPopularityWeights,
} from '../fnddsPrior.js';

const SURVEY = [
    { fdcId: 'S1', foodCode: '11111111' },
    { fdcId: 'S2', foodCode: '22222222' },
];

describe('deriveSrPriors — gram-share decomposition with recursive FNDDS-code resolution', () => {
    it("distributes a survey food's weight to its SR ingredients by gram share", () => {
        const priors = deriveSrPriors({
            surveyFoods: SURVEY,
            inputFoods: [
                { surveyFdcId: 'S1', srCode: '1077', gramWeight: 75 },
                { surveyFdcId: 'S1', srCode: '19335', gramWeight: 25 },
            ],
            intake: [{ foodCode: '11111111', weight: 1000 }],
        });

        expect(priors.get('1077')).toBeCloseTo(750);
        expect(priors.get('19335')).toBeCloseTo(250);
    });

    it("⛔ resolves an 8-digit sr_code THROUGH that survey food's own decomposition — the 95.3% fact", () => {
        const priors = deriveSrPriors({
            surveyFoods: SURVEY,
            inputFoods: [
                { surveyFdcId: 'S1', srCode: '22222222', gramWeight: 50 },
                { surveyFdcId: 'S1', srCode: '1077', gramWeight: 50 },
                { surveyFdcId: 'S2', srCode: '19335', gramWeight: 10 },
            ],
            intake: [{ foodCode: '11111111', weight: 100 }],
        });

        expect(priors.get('1077')).toBeCloseTo(50);
        expect(priors.get('19335')).toBeCloseTo(50);
        expect(priors.has('22222222')).toBe(false);
    });

    it('a cycle in the decomposition terminates rather than looping', () => {
        const priors = deriveSrPriors({
            surveyFoods: SURVEY,
            inputFoods: [
                { surveyFdcId: 'S1', srCode: '22222222', gramWeight: 100 },
                { surveyFdcId: 'S2', srCode: '11111111', gramWeight: 100 },
            ],
            intake: [{ foodCode: '11111111', weight: 100 }],
        });

        expect([...priors.values()].every((weight) => Number.isFinite(weight))).toBe(true);
    });
});

/**
 * Rewritten for curated plan U5 slice 0: the fraction is now a decimal string rounded half up to nine places, computed
 * with `decimal.js` rather than `Math.log1p`, so the SQL verifier's `numeric` arithmetic can reproduce it exactly.
 * Each expected value below was computed at 60 significant digits outside this code.
 */
describe('normalizePriorFraction — the fixed-ceiling log normalization, nine places', () => {
    it('maps zero to zero and the reference ceiling to exactly one', () => {
        expect(normalizePriorFraction('0')).toBe('0');
        expect(normalizePriorFraction(String(PRIOR_WEIGHT_CEILING))).toBe('1');
    });

    it('⛔ clamps ABOVE the ceiling — a bigger cycle must not mint a fraction over 1', () => {
        expect(normalizePriorFraction(String(PRIOR_WEIGHT_CEILING * 10))).toBe('1');
    });

    it('is ln(1 + weight) ÷ ln(1 + ceiling), rounded half up to nine places', () => {
        expect(normalizePriorFraction('1')).toBe('0.034605246');
        expect(normalizePriorFraction('1002500')).toBe('0.689861537');
        expect(normalizePriorFraction('10000000')).toBe('0.804692974');
        expect(normalizePriorFraction('463000000.1234')).toBe('0.996161728');
    });
});

describe('sumPopularityWeights — an item’s weight is the exact sum of its sources’ committed text (R45)', () => {
    it('sums the canonical text exactly, beyond the 20 significant digits a default Decimal keeps', () => {
        expect(sumPopularityWeights([463000000.1234568, 1.23e-12])).toBe('463000000.12345680000123');
    });

    it('is zero for no weights', () => {
        expect(sumPopularityWeights([])).toBe('0');
    });

    it('adds no float error: 0.1 + 0.2 is 0.3', () => {
        expect(sumPopularityWeights([0.1, 0.2])).toBe('0.3');
    });
});

describe('evaluateStapleGate — the LOUD acceptance gate with its measured exceptions', () => {
    const covered = new Map(
        STAPLE_EXPECTATIONS.filter((staple) => staple.exception === undefined).map((staple) => [staple.ndb, 1000]),
    );

    it('passes when every non-exception staple received a prior', () => {
        expect(evaluateStapleGate(covered).ok).toBe(true);
    });

    it('⛔ FAILS LOUDLY, naming the row, when a coverable staple got nothing', () => {
        const missingFlour = new Map(covered);
        missingFlour.delete('20081');

        const verdict = evaluateStapleGate(missingFlour);

        expect(verdict.ok).toBe(false);
        expect(verdict.missing.join()).toContain('flour');
    });

    it('the three structural exceptions are NAMED, with their measured reasons, and never fail the gate', () => {
        const exceptions = STAPLE_EXPECTATIONS.filter((staple) => staple.exception !== undefined);

        expect(exceptions.map((staple) => staple.query).sort()).toEqual(['mace', 'olive oil', 'vanilla']);

        for (const staple of exceptions) {
            expect(staple.exception).toMatch(/FNDDS|SR Legacy/);
        }
    });
});

describe('popularity JSONL — what the generator commits instead of upserting', () => {
    it('writes, per SR item, the weight the old database writer upserted for the same inputs', () => {
        // The old writer upserted (the crosswalked fdc id, the weight) for every SR code that crosswalks.
        // S1 = 75 g of NDB 1077 + 25 g of NDB 19335, eaten with weight 1000 → 750 and 250; NDB 4063 has no
        // SR Legacy row, so, as before, it is not written.
        const srWeights = deriveSrPriors({
            surveyFoods: SURVEY,
            inputFoods: [
                { surveyFdcId: 'S1', srCode: '1077', gramWeight: 75 },
                { surveyFdcId: 'S1', srCode: '19335', gramWeight: 25 },
                { surveyFdcId: 'S2', srCode: '4063', gramWeight: 10 },
            ],
            intake: [
                { foodCode: '11111111', weight: 1000 },
                { foodCode: '22222222', weight: 7 },
            ],
        });
        const fdcByNdb = new Map([
            ['1077', '10'],
            ['19335', '9'],
        ]);

        expect(renderPopularityJsonl(popularityWeightsByItem(srWeights, fdcByNdb))).toBe(
            '{"item":"fdc:9","weight":250}\n{"item":"fdc:10","weight":750}\n',
        );
    });

    it('sorts by numeric FDC id, so fdc:9 precedes fdc:10 and fdc:100', () => {
        const text = renderPopularityJsonl(
            new Map([
                ['fdc:100', 1],
                ['fdc:10', 2],
                ['fdc:9', 3],
            ] as const),
        );

        expect(
            text
                .split('\n')
                .slice(0, 3)
                .map((line) => JSON.parse(line) as { item: string }),
        ).toEqual([
            { item: 'fdc:9', weight: 3 },
            { item: 'fdc:10', weight: 2 },
            { item: 'fdc:100', weight: 1 },
        ]);
    });

    it('refuses two NDB numbers that crosswalk to one FDC item, which would lose a weight silently', () => {
        expect(() =>
            popularityWeightsByItem(
                new Map([
                    ['1077', 1],
                    ['1078', 2],
                ]),
                new Map([
                    ['1077', '10'],
                    ['1078', '10'],
                ]),
            ),
        ).toThrow(/fdc:10/);
    });

    it('parses what it renders', () => {
        const weights = new Map([
            ['fdc:9', 250.125],
            ['fdc:10', 0],
            ['fdc:173430', 4.63e8],
        ] as const);

        expect(parsePopularityJsonl(renderPopularityJsonl(weights))).toEqual(new Map(weights));
    });

    it.each([
        ['a line out of id order', '{"item":"fdc:10","weight":1}\n{"item":"fdc:9","weight":1}\n', 2],
        ['a repeated item', '{"item":"fdc:9","weight":1}\n{"item":"fdc:9","weight":2}\n', 2],
        ['an unknown key', '{"item":"fdc:9","weight":1,"source":"x"}\n', 1],
        ['a curated key', '{"item":"curated:x","weight":1}\n', 1],
        ['a negative weight', '{"item":"fdc:9","weight":-1}\n', 1],
        ['a non-canonical rendering', '{"weight":1,"item":"fdc:9"}\n', 1],
        ['a missing trailing newline', '{"item":"fdc:9","weight":1}', 1],
        ['a line that is not JSON', '{\n', 1],
    ])('refuses %s, naming the line', (_label, text, line) => {
        let caught: unknown;

        try {
            parsePopularityJsonl(text);
        } catch (error) {
            caught = error;
        }

        expect(isSeedRefusedError(caught) && caught.issues[0]).toMatchObject({
            rule: 'malformedRecord',
            where: `foodPopularity.jsonl:${String(line)}`,
        });
    });
});
