/**
 * The dotted line's text rules, shared by both leaves (`docs/design/ingredientSpecialization.md` §2d and §S4): which
 * token is a measurement that never breaks at its hyphen, and how a part splits into runs around those tokens.
 */
import { describe, expect, it } from 'vitest';

import { isMeasurementToken, partRuns, PART_SEPARATOR, spokenVariantParts } from '../variantPartsText.js';

describe('isMeasurementToken', () => {
    it.each(['0-inch', '1/8-inch', '1.5-inch', '12-INCH'])('treats %s as a measurement', (token) => {
        expect(isMeasurementToken(token)).toBe(true);
    });

    it.each([
        ['a hyphenated word', 'chocolate-flavored'],
        ['a number with no unit', '12'],
        ['a unit with no number', '-inch'],
        ['a number after a letter', 'x1/8-inch'],
        ['two hyphens', '1-8-inch'],
        ['a token with a trailing space', '1/8-inch '],
        ['a plain word', 'brisket'],
    ])('does not treat %s as a measurement', (_, token) => {
        expect(isMeasurementToken(token)).toBe(false);
    });
});

describe('partRuns', () => {
    it('splits a measurement token out of its part and keeps every character, spaces included', () => {
        expect(partRuns('1/8-inch trim')).toStrictEqual([
            { text: '1/8-inch', measurement: true },
            { text: ' trim', measurement: false },
        ]);
        expect(partRuns('trimmed to 0-inch fat')).toStrictEqual([
            { text: 'trimmed to ', measurement: false },
            { text: '0-inch', measurement: true },
            { text: ' fat', measurement: false },
        ]);
    });

    it('gives a part with no measurement one run', () => {
        expect(partRuns('separable lean and fat')).toStrictEqual([
            { text: 'separable lean and fat', measurement: false },
        ]);
        expect(partRuns('chocolate-flavored')).toStrictEqual([{ text: 'chocolate-flavored', measurement: false }]);
    });

    it('never drops or reorders text', () => {
        const parts = ['1/8-inch trim', 'a 1-inch and 2-inch cut', '  spaced  ', 'flat half'];

        for (const part of parts) {
            expect(
                partRuns(part)
                    .map((run) => run.text)
                    .join(''),
            ).toBe(part);
        }
    });
});

describe('PART_SEPARATOR', () => {
    it('is a no-break space then a middle dot, so a dot never starts a line', () => {
        expect(PART_SEPARATOR).toBe('\u00A0\u00B7');
    });
});

describe('spokenVariantParts', () => {
    it('joins the source parts with commas, keeping wire order and each part’s own hyphen', () => {
        expect(spokenVariantParts(['flat half', '1/8-inch trim', 'select'])).toBe('flat half, 1/8-inch trim, select');
    });

    it('is the part itself for one part', () => {
        expect(spokenVariantParts(['whole'])).toBe('whole');
    });
});
