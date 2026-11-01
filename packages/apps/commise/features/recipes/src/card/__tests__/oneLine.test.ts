import { describe, expect, it } from 'vitest';

import { badgeHeightOf } from '@commise/ui/badge-box';
import { cappedFontScale } from '@commise/ui/font-scale-cap';

import { badgeLineHeightOf, metaLineHeightOf } from '../oneLine.js';

/**
 * The height of a native card's one-line rows (`docs/design/uiOverhaul/buildSpec.md` §4.1 "one line", A-028 / W-06):
 * exactly the line the row holds, scaled by the OS font scale, so a dropped item is fully hidden and nothing is clipped.
 */
describe('metaLineHeightOf', () => {
    it.each([
        [1, 20],
        [1.3, 26],
        [2, 40],
    ])('uses the 20 pt meta leading × %s up to %s', (fontScale, expected) => {
        expect(metaLineHeightOf(fontScale)).toBe(expected);
    });
});

describe('badgeLineHeightOf', () => {
    // REWRITTEN (designer review M-2): the row read its own copy of the badge's floor and padding and left out a neutral
    // badge's edges, so it was 2 pt short of the badge. It now reads the design system's badge box, so it is never
    // shorter than either badge it can hold: the status badge at the capped scale, the difficulty badge at the system
    // scale (its word is not on the capped Text yet).
    it.each([1, 1.3, 2, 2.5, 3.1])('at scale %s holds both badges and the meta text', (scale) => {
        expect(badgeLineHeightOf(scale)).toBeGreaterThanOrEqual(badgeHeightOf(cappedFontScale(scale)));
        expect(badgeLineHeightOf(scale)).toBeGreaterThanOrEqual(badgeHeightOf(scale));
        expect(badgeLineHeightOf(scale)).toBeGreaterThanOrEqual(metaLineHeightOf(scale));
    });

    it('is exactly the tallest of them, so no space is left above the row', () => {
        for (const scale of [1, 1.3, 2, 2.5, 3.1]) {
            expect(badgeLineHeightOf(scale)).toBe(
                Math.max(badgeHeightOf(cappedFontScale(scale)), badgeHeightOf(scale), metaLineHeightOf(scale)),
            );
        }
    });

    it('keeps the 24 pt badge floor at the default scale', () => {
        expect(badgeLineHeightOf(1)).toBe(24);
    });

    it('grows with the larger of the badge word (caption + 4 pt padding) and the meta text beside it', () => {
        // REWRITTEN for the px type scale (2026-10-25): caption is 20 pt now, as meta is (it was 16.8 against 19.6), so
        // the badge word decides: 20 × 2 + 4 = 44, above the meta line's 20 × 2 = 40.
        expect(badgeLineHeightOf(2)).toBe(44);
    });

    it('never answers less than the meta line it can hold', () => {
        for (const scale of [1, 1.15, 1.5, 2]) {
            expect(badgeLineHeightOf(scale)).toBeGreaterThanOrEqual(metaLineHeightOf(scale));
        }
    });
});
