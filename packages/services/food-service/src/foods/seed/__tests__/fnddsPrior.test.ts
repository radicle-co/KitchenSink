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
 */
import { describe, expect, it } from 'vitest';

import {
    PRIOR_WEIGHT_CEILING,
    STAPLE_EXPECTATIONS,
    deriveSrPriors,
    evaluateStapleGate,
    normalizePriorFraction,
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

describe('normalizePriorFraction — the fixed-ceiling log normalization', () => {
    it('maps zero to zero and the reference ceiling to one', () => {
        expect(normalizePriorFraction(0)).toBe(0);
        expect(normalizePriorFraction(PRIOR_WEIGHT_CEILING)).toBeCloseTo(1, 5);
    });

    it('⛔ clamps ABOVE the ceiling — a bigger cycle must not mint a fraction over 1', () => {
        expect(normalizePriorFraction(PRIOR_WEIGHT_CEILING * 10)).toBe(1);
    });

    it('is log-shaped: a staple at ~1e7 lands well above half', () => {
        expect(normalizePriorFraction(1e7)).toBeGreaterThan(0.7);
        expect(normalizePriorFraction(1e7)).toBeLessThan(0.9);
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
