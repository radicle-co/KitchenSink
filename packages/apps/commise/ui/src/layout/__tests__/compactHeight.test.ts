/**
 * The compact-height predicate (`docs/design/compactHeightLayout.md` §2): Android's window size classes call a window
 * under 480 dp tall compact, which is every phone held sideways and nothing held upright. The screen frames change
 * layout on it, and step aside for the keyboard only when compact AND a keyboard is open.
 */
import { describe, expect, it } from 'vitest';

import { COMPACT_HEIGHT_BELOW_DP, isCompactHeight, isFrameCollapsed } from '../compactHeight.js';

describe('isCompactHeight', () => {
    it('is compact strictly below 480 dp, as Material states the class', () => {
        expect(COMPACT_HEIGHT_BELOW_DP).toBe(480);
        expect(isCompactHeight(479)).toBe(true);
        expect(isCompactHeight(480)).toBe(false);
    });

    it.each([
        [393, true, 'a Pixel 5 held sideways'],
        [390, true, 'an iPhone 14 held sideways'],
        [851, false, 'a Pixel 5 held upright'],
        [568, false, 'an iPhone SE held upright, the shortest upright phone'],
        [820, false, 'an iPad held sideways'],
    ])('window %d dp tall → compact %s (%s)', (height, compact) => {
        expect(isCompactHeight(height)).toBe(compact);
    });
});

describe('isFrameCollapsed', () => {
    it.each([
        [false, false, false],
        [false, true, false],
        [true, false, false],
        [true, true, true],
    ])('compact %s, keyboard %s → collapsed %s', (compact, keyboardOpen, collapsed) => {
        expect(isFrameCollapsed(compact, keyboardOpen)).toBe(collapsed);
    });
});
