/**
 * Unit tests for the auto-computed total-time rule (`form/totalTime.ts`).
 */
import { describe, expect, it } from 'vitest';
import { computeTotalTime } from '../totalTime.js';

describe('computeTotalTime', () => {
    it('sums prep + cook', () => {
        expect(computeTotalTime(10, 25)).toBe(35);
        expect(computeTotalTime(0, 0)).toBe(0);
    });
});
