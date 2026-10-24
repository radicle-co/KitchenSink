import { describe, expect, it } from 'vitest';

import { sentenceCase } from '../sentenceCase.js';

/**
 * Sentence case for a facet label (`docs/design/uiOverhaul/buildSpec.md` §4.3 "Labels sentence case from the facet
 * value", W-10): the first letter upper, the rest untouched — so an acronym or a proper noun inside survives — in the
 * viewer's locale, because case is a locale rule (Turkish has a dotted capital I).
 */
describe('sentenceCase', () => {
    it.each([
        ['dairy-free', 'Dairy-free'],
        ['vegan', 'Vegan'],
        ['Thai', 'Thai'],
        ['gluten free', 'Gluten free'],
        ['BBQ night', 'BBQ night'],
    ])('lifts the first letter of "%s"', (value, expected) => {
        expect(sentenceCase(value, 'en')).toBe(expected);
    });

    it('lifts an accented first letter', () => {
        expect(sentenceCase('éclair', 'fr')).toBe('Éclair');
    });

    it('uses the locale’s own capital: the Turkish dotted I', () => {
        expect(sentenceCase('italyan', 'tr')).toBe('İtalyan');
        expect(sentenceCase('italyan', 'en')).toBe('Italyan');
    });

    it('lifts a whole code point, never half a surrogate pair', () => {
        // U+10428 DESERET SMALL LETTER LONG I → U+10400 DESERET CAPITAL LETTER LONG I: two UTF-16 units.
        expect(sentenceCase('\u{10428}x', 'en')).toBe('\u{10400}x');
    });

    it('answers an empty value with an empty label', () => {
        expect(sentenceCase('', 'en')).toBe('');
    });
});
