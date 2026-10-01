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
