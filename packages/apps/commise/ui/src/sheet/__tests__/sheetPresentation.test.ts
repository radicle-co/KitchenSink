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
    sheetIsCentred,
    sheetWidthStyle,
    SHEET_DIALOG_MAX_WIDTH_DP,
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

describe('sheetWidthStyle - the dialog presentation (owner ruling 2026-10-26, platform guidelines)', () => {
    it('is a bottom sheet on a phone: full width, exactly as the sheet presentation is', () => {
        expect(sheetWidthStyle(390, 'dialog')).toStrictEqual({ width: '100%' });
    });

    it('is a centred dialog at most 448 dp wide from the tablet width, 834 and 1194 alike', () => {
        expect(SHEET_DIALOG_MAX_WIDTH_DP).toBe(448);
        expect(sheetWidthStyle(600, 'dialog')).toStrictEqual({ width: '100%', maxWidth: 448 });
        expect(sheetWidthStyle(834, 'dialog')).toStrictEqual({ width: '100%', maxWidth: 448 });
        expect(sheetWidthStyle(1194, 'dialog')).toStrictEqual({ width: '100%', maxWidth: 448 });
    });

    it('says when it is centred: only the dialog presentation, only from the tablet width', () => {
        expect(sheetIsCentred('dialog', 599)).toBe(false);
        expect(sheetIsCentred('dialog', 600)).toBe(true);
        expect(sheetIsCentred('sheet', 1194)).toBe(false);
    });

    it('reaches the side insets by the gap to a 448 dp card, not a 560 dp one', () => {
        expect(sheetSideInsetPadding(834, 200, 'dialog')).toBe(Math.max(0, 200 - (834 - 448) / 2));
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
