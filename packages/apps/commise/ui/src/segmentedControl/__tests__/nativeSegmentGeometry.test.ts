/**
 * The room a native segment leaves its label: the per-locale fit test reads it to prove that no label breaks inside a
 * word at the chrome cap (designer ruling 2026-11-01, ADR-0080 §8). The numbers are the native control's own spacing
 * tokens, so a change to its padding moves this test and the fit test with it.
 */
import { describe, expect, it } from 'vitest';

import { spacing } from '../../tokens/scale.js';
import { segmentLabelRoom } from '../nativeSegmentGeometry.js';

describe('segmentLabelRoom', () => {
    // 328 is a 360 pt phone less its 16 pt gutters. The track pads 4 on each side and puts 4 between the two segments;
    // each segment pads 12 on each side inside a 1 pt edge: (328 − 8 − 4) / 2 − 24 − 2 = 132.
    it('leaves each of two shared segments 132 pt on a 360 pt phone', () => {
        expect(segmentLabelRoom({ trackWidth: 360 - 2 * spacing[4], count: 2, withIcon: false })).toBe(132);
    });

    it('splits the row among more segments', () => {
        expect(segmentLabelRoom({ trackWidth: 328, count: 3, withIcon: false })).toBeCloseTo((328 - 8 - 8) / 3 - 26, 6);
    });

    it('takes an icon and its gap out of the label’s room', () => {
        expect(segmentLabelRoom({ trackWidth: 328, count: 2, withIcon: true })).toBe(132 - 20 - spacing[2]);
    });

    it('refuses a control with no segments', () => {
        expect(() => segmentLabelRoom({ trackWidth: 328, count: 0, withIcon: false })).toThrow(/segment/u);
    });
});
