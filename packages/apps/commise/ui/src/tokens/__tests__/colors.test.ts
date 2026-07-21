/**
 * Token invariants for the design-system colors. The chart palette must give each nutrition series a
 * DISTINCT hue (B25a) — two identical colors render as one indistinguishable series.
 */
import { describe, expect, it } from 'vitest';

import { chart } from '../colors.js';

describe('chart tokens', () => {
    it('assigns a distinct hue to every nutrition series', () => {
        const hues = Object.values(chart);

        expect(new Set(hues).size).toBe(hues.length);
    });

    it('keeps calories and protein visually distinct (the B25a collision)', () => {
        expect(chart.calories).not.toBe(chart.protein);
    });
});
