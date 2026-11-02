import { describe, expect, it } from 'vitest';

import { keyboardOverlap } from '../keyboardOverlap.js';

describe('keyboardOverlap', () => {
    it.each([
        ['covers the foot of the box', 2400, 1389, 1011],
        ['covers part of a box that ends above the screen foot', 1500, 1389, 111],
        ['starts exactly at the box’s bottom edge', 1389, 1389, 0],
        ['starts below the box', 1000, 1389, 0],
        ['is not up', 2400, null, 0],
        ['is up before the box is measured', null, 1389, 0],
    ] as const)('when the keyboard %s', (_shape, bottom, top, expected) => {
        expect(keyboardOverlap(bottom, top, top === null ? 0 : 2400 - top)).toBe(expected);
    });
});

describe('keyboardOverlap — a bad measurement cannot lift further than the keyboard is tall', () => {
    // A box measured while the engine's slide transform still applies reports a bottom edge past the screen. Counting that
    // lifted the foot by more than the keyboard covers, pushing the panel out of its own frame.
    it('is at most the keyboard height, however far past the screen the box seems to end', () => {
        expect(keyboardOverlap(4800, 1389, 1011)).toBe(1011);
    });

    it('is the measured overlap when that is less than the keyboard height', () => {
        expect(keyboardOverlap(1500, 1389, 1011)).toBe(111);
    });
});
