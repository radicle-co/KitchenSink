/**
 * The one box both native badges draw (status and difficulty), and the height it takes at a system font scale. The card
 * row that holds a badge reads its height from here, so the row and the badge cannot disagree again: the row had
 * restated a 4 pt padding and left out a neutral badge's 1 pt edges, so it was 2 pt short of the badge it held.
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../../tokens/native.js';
import { BADGE_BOX, badgeHeightOf } from '../badgeBox.js';
import { cappedFontScale, FONT_SCALE_CAP } from '../../text/fontScaleCap.js';

describe('BADGE_BOX', () => {
    it('fits a caption line, its padding and its edges exactly in the 24 pt floor, so every tone draws 24 pt', () => {
        const { minHeight, paddingVertical, borderWidth } = BADGE_BOX;

        expect(minHeight).toBe(24);
        expect(nativeTokens.type.caption.lineHeight + 2 * (paddingVertical + borderWidth)).toBe(minHeight);
    });
});

describe('badgeHeightOf', () => {
    it.each([
        [1, 24],
        [1.3, 30],
        [2, 44],
        [3, 64],
    ])('at font scale %s is %s pt: the floor, or the scaled caption with its padding and edges', (scale, height) => {
        expect(badgeHeightOf(scale)).toBe(height);
    });
});

describe('cappedFontScale', () => {
    it('is the system scale up to the 2× cap (owner ruling, ADR-0080 §8)', () => {
        expect(FONT_SCALE_CAP).toBe(2);
        expect(cappedFontScale(1.5)).toBe(1.5);
        expect(cappedFontScale(3.1)).toBe(2);
    });
});
