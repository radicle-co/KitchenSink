/**
 * `toPer100g`, `labelPer100g` and `brandedPer100g` (plan R54, KTD-20, KTD-24): the one place a cited value changes. A value per 100 mL converts with a density
 * cited from the same source, and energy given only in kJ converts at 4.184 kJ per kcal. Each conversion is recorded,
 * because CC BY 4.0 §3(a)(1)(B) requires saying that the material was changed.
 */
import { describe, expect, it } from 'vitest';

import { makeBrandedProduct, makeExtractLine, makeLabel } from '../__fixtures__/curatedSeed.fixtures.js';
import { brandedPer100g, labelPer100g, toPer100g } from '../basisConversion.js';

describe('toPer100g', () => {
    it('passes a per-100 g line through unchanged, with no conversion recorded', () => {
        expect(toPer100g(makeExtractLine({ values: { ENERC_KCAL: '52', CHOAVL: '12.4' } }))).toEqual({
            values: { ENERC_KCAL: '52', CHOAVL: '12.4' },
            conversions: [],
        });
    });

    it('divides every per-100 mL value by the density, rounded to three places, and records it', () => {
        const port = makeExtractLine({
            basis: 'per100mL',
            values: { ENERC_KCAL: '157', CHOAVLM: '12' },
            densityGramsPerMl: '1.03',
        });

        expect(toPer100g(port)).toEqual({
            values: { ENERC_KCAL: '152.427', CHOAVLM: '11.65' },
            conversions: [{ kind: 'volumeToMass', densityGramsPerMl: '1.03' }],
        });
    });

    it('rounds half away from zero, as the verifier’s SQL round() does', () => {
        // 1.0005 / 1 rounds to 1.001, never to the even 1.000.
        const line = makeExtractLine({ basis: 'per100mL', values: { FAT: '1.0005' }, densityGramsPerMl: '1' });

        expect(toPer100g(line).values).toEqual({ FAT: '1.001' });
    });

    it('converts kJ to kcal at 4.184 when the source gives no kcal, and records it', () => {
        expect(toPer100g(makeExtractLine({ values: { ENERC_KJ: '1000' } }))).toEqual({
            values: { ENERC_KJ: '1000', ENERC_KCAL: '239.006' },
            conversions: [{ kind: 'kilojoulesToKilocalories' }],
        });
    });

    it('keeps a published kcal value even when kJ is also given', () => {
        expect(toPer100g(makeExtractLine({ values: { ENERC_KJ: '1000', ENERC_KCAL: '240' } })).values).toEqual({
            ENERC_KJ: '1000',
            ENERC_KCAL: '240',
        });
    });

    it('converts volume first, then energy, and records both', () => {
        const line = makeExtractLine({ basis: 'per100mL', values: { ENERC_KJ: '418.4' }, densityGramsPerMl: '2' });

        expect(toPer100g(line)).toEqual({
            values: { ENERC_KJ: '209.2', ENERC_KCAL: '50' },
            conversions: [{ kind: 'volumeToMass', densityGramsPerMl: '2' }, { kind: 'kilojoulesToKilocalories' }],
        });
    });

    it('carries the trace marks unchanged, since a trace is 0 on any basis', () => {
        const line = makeExtractLine({
            basis: 'per100mL',
            values: { FAT: '2.06' },
            densityGramsPerMl: '1.03',
            traces: ['FIBTG'],
        });

        expect(toPer100g(line)).toEqual({
            values: { FAT: '2' },
            traces: ['FIBTG'],
            conversions: [{ kind: 'volumeToMass', densityGramsPerMl: '1.03' }],
        });
    });
});

describe('labelPer100g', () => {
    it('scales each printed value by 100 ÷ serving grams, rounded half up to three places (KTD-20)', () => {
        const label = makeLabel({
            serving: { label: '2 tbsp', grams: '30' },
            perServing: [
                { name: 'Energy', unit: 'kcal', amount: '120' },
                { name: 'Protein', unit: 'g', amount: '2.5' },
            ],
        });

        expect(labelPer100g(label)).toEqual([
            { name: 'Energy', unit: 'kcal', amount: '400' },
            { name: 'Protein', unit: 'g', amount: '8.333' },
        ]);
    });

    it('rounds a tie away from zero, as SQL round() does, and never through a float', () => {
        // 1.0005 × 100 ÷ 100 is a tie at the third place; a float product reads 1.0004999… and rounds down.
        const label = makeLabel({
            serving: { label: '100 g', grams: '100' },
            perServing: [{ name: 'Total lipid (fat)', unit: 'g', amount: '1.0005' }],
        });

        expect(labelPer100g(label)).toEqual([{ name: 'Total lipid (fat)', unit: 'g', amount: '1.001' }]);
    });

    it('drops a printed zero in any spelling: absent, never 0 (OQ-2, 21 CFR 101.9(c))', () => {
        const label = makeLabel({
            serving: { label: '1/4 tsp', grams: '0.8' },
            perServing: [
                { name: 'Energy', unit: 'kcal', amount: '0' },
                { name: 'Sodium, na', unit: 'mg', amount: '190' },
                { name: 'Protein', unit: 'g', amount: '0.0' },
            ],
        });

        expect(labelPer100g(label)).toEqual([{ name: 'Sodium, na', unit: 'mg', amount: '23750' }]);
    });

    it('keeps a printed non-zero value that rounds to zero as 0: only a PRINTED zero is absent', () => {
        const label = makeLabel({
            serving: { label: '100 g', grams: '100' },
            perServing: [{ name: 'Iron, fe', unit: 'mg', amount: '0.0004' }],
        });

        expect(labelPer100g(label)).toEqual([{ name: 'Iron, fe', unit: 'mg', amount: '0' }]);
    });
});

describe('brandedPer100g', () => {
    it('passes a gram-served product’s amounts through as written, under the live parser’s canonical names', () => {
        const product = makeBrandedProduct({
            nutrients: [
                { amount: '23750', name: 'Sodium, Na', nutrientId: 1093, unitName: 'MG' },
                { amount: '1.25', name: 'Total lipid (fat)', nutrientId: 1004, unitName: 'G' },
            ],
        });

        expect(brandedPer100g(product)).toEqual([
            { name: 'Sodium, na', unit: 'mg', amount: '23750' },
            { name: 'Total lipid (fat)', unit: 'g', amount: '1.25' },
        ]);
    });

    it('drops a Branded zero in any spelling: absent, never 0 (OQ-2)', () => {
        const product = makeBrandedProduct({
            nutrients: [
                { amount: '0', name: 'Energy', nutrientId: 1008, unitName: 'KCAL' },
                { amount: '0.00', name: 'Protein', nutrientId: 1003, unitName: 'G' },
                { amount: '3', name: 'Sugars, total including NLEA', nutrientId: 2000, unitName: 'G' },
            ],
        });

        expect(brandedPer100g(product)).toEqual([{ name: 'Sugars, total including nlea', unit: 'g', amount: '3' }]);
    });

    it('drops a row whose nutrient id nutrient.csv does not define, as the bulk parser does', () => {
        const product = makeBrandedProduct({
            nutrients: [{ amount: '4', name: '', nutrientId: 2066, unitName: '' }],
        });

        expect(brandedPer100g(product)).toEqual([]);
    });

    it('refuses an amount that is not a plain decimal, naming the product and nutrient', () => {
        const product = makeBrandedProduct({
            nutrients: [{ amount: '1e3', name: 'Protein', nutrientId: 1003, unitName: 'G' }],
        });

        expect(() => brandedPer100g(product)).toThrow(/2096555.*1003/u);
    });
});
