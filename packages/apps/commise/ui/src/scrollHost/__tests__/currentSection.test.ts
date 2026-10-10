/**
 * The scroll spy's one algorithm (blueprint A7): which section the reader is in, from each section's top, the scroll
 * position and the activation line. Both platforms feed it — web from `getBoundingClientRect`, native from `onLayout`.
 */
import { describe, expect, it } from 'vitest';

import { currentSectionOf, type SectionTop } from '../currentSection.js';

const TOPS: readonly SectionTop[] = [
    { id: 'details', top: 0 },
    { id: 'ingredients', top: 600 },
    { id: 'steps', top: 1400 },
];

describe('currentSectionOf', () => {
    const cases: readonly (readonly [string, number, number, boolean, string | undefined])[] = [
        ['at the top, the first section is current', 0, 0, false, 'details'],
        ['just before the second section crosses the line, the first stays current', 499, 100, false, 'details'],
        ['the second section is current once its top reaches the activation line', 500, 100, false, 'ingredients'],
        ['between two tops, the earlier one is current', 900, 100, false, 'ingredients'],
        ['the last section is current once its top crosses', 1300, 100, false, 'steps'],
        ['at the end of the page the LAST section is current even if its top never crossed', 1000, 0, true, 'steps'],
    ];

    it.each(cases)('%s', (_name, scrollY, activationY, atEnd, expected) => {
        expect(currentSectionOf(TOPS, scrollY, activationY, atEnd)).toBe(expected);
    });

    it('is undefined before the first section reaches the line (a page with a header above its sections)', () => {
        expect(currentSectionOf([{ id: 'a', top: 300 }], 0, 100, false)).toBeUndefined();
    });

    it('is undefined with no sections, even at the end', () => {
        expect(currentSectionOf([], 500, 0, true)).toBeUndefined();
    });

    it('reads tops in any order: the answer is by position, not by array index', () => {
        const shuffled = [TOPS[1], TOPS[0], TOPS[2]].filter((top): top is SectionTop => top !== undefined);

        expect(currentSectionOf(shuffled, 700, 0, false)).toBe('ingredients');
    });
});
