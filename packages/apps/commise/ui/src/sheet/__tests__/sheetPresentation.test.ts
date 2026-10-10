/**
 * The native sheet's presentation rules (§S8.1): full width on a phone, capped at 560 dp from 600 dp, and a slide
 * only when reduce motion is known to be off.
 */
import { describe, expect, it } from 'vitest';

import { spacing } from '../../tokens/scale.js';
import {
    SHEET_EDGE_PADDING_DP,
    SHEET_MAX_WIDTH_DP,
    SHEET_WIDE_FROM_DP,
    sheetAnimationType,
    sheetSideInsetPadding,
    sheetWidthStyle,
} from '../sheetPresentation.js';

describe('sheetWidthStyle', () => {
    it('is full width below 600 dp', () => {
        expect(SHEET_WIDE_FROM_DP).toBe(600);
        expect(sheetWidthStyle(320)).toStrictEqual({ width: '100%' });
        expect(sheetWidthStyle(599)).toStrictEqual({ width: '100%' });
    });

    it('caps the width at 560 dp from 600 dp', () => {
        expect(SHEET_MAX_WIDTH_DP).toBe(560);
        expect(sheetWidthStyle(600)).toStrictEqual({ width: '100%', maxWidth: 560 });
        expect(sheetWidthStyle(1024)).toStrictEqual({ width: '100%', maxWidth: 560 });
    });
});

describe('SHEET_EDGE_PADDING_DP', () => {
    it('is the 16 dp spacing step, the padding the filter bar sheet used before the primitive', () => {
        expect(SHEET_EDGE_PADDING_DP).toBe(spacing[4]);
        expect(SHEET_EDGE_PADDING_DP).toBe(16);
    });
});

describe('sheetAnimationType', () => {
    it('slides only when reduce motion is known to be off', () => {
        expect(sheetAnimationType(false)).toBe('slide');
    });

    it('does not animate when reduce motion is on, or not yet known', () => {
        expect(sheetAnimationType(true)).toBe('none');
        expect(sheetAnimationType(undefined)).toBe('none');
    });
});

// `docs/design/compactHeightLayout.md` §6 (A6): from 600 dp the sheet is centred at 560 dp, so a side inset only needs
// the part of it the sheet actually reaches. A 3-button navigation bar on a sideways phone used to cost the sheet 48 dp.
describe('sheetSideInsetPadding', () => {
    it.each([
        [851, 48, 0, 'a Pixel 5 sideways: the centred sheet is 145.5 dp clear of the bar'],
        [600, 48, 28, 'the narrowest centred window: the sheet reaches 28 dp into the bar'],
        [599, 48, 48, 'below 600 dp the sheet is full width and takes the whole inset'],
        [393, 0, 0, 'an upright phone with no side inset'],
    ])('window %d, inset %d → padding %d (%s)', (windowWidth, inset, padding) => {
        expect(sheetSideInsetPadding(windowWidth, inset)).toBe(padding);
    });

    it('treats each side on its own: the bar is on one side only', () => {
        expect([sheetSideInsetPadding(640, 48), sheetSideInsetPadding(640, 0)]).toStrictEqual([8, 0]);
    });
});
