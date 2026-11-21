import { describe, expect, it } from 'vitest';

import { isSideBySide } from '../isSideBySide.js';

/**
 * The native row decision, in text units: side by side iff the measured width is at least `sideBySideFrom` times the
 * font scale clamped to [1, 2] (staff D1, D4). Each clamp has its own case, so removing it fails exactly one.
 */
describe('isSideBySide', () => {
    it('stacks before it has been measured', () => {
        expect(isSideBySide(null, 400, 1)).toBe(false);
    });

    it('is a row from the threshold at scale 1', () => {
        expect(isSideBySide(399, 400, 1)).toBe(false);
        expect(isSideBySide(400, 400, 1)).toBe(true);
    });

    it('moves the threshold with the scale: 800 at scale 2', () => {
        expect(isSideBySide(799, 400, 2)).toBe(false);
        expect(isSideBySide(800, 400, 2)).toBe(true);
    });

    it('caps the scale at 2: width 800 at scale 3.571 is a row (uncapped the threshold is 1428)', () => {
        expect(isSideBySide(800, 400, 3.571)).toBe(true);
    });

    it('floors the scale at 1: width 358 stacks at 0.882 and 0.823 (unfloored 353 and 329 would be rows)', () => {
        expect(isSideBySide(358, 400, 0.882)).toBe(false);
        expect(isSideBySide(358, 400, 0.823)).toBe(false);
    });

    it('drops the scale term nowhere: an iPad box of 416 stacks at 1.118 (400 x 1.118 = 447)', () => {
        expect(isSideBySide(416, 400, 1.118)).toBe(false);
        expect(isSideBySide(416, 400, 1)).toBe(true);
    });
});
