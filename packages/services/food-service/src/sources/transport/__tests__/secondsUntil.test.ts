/**
 * The whole seconds a caller is told to wait for an instant a refusal named (ADR-0053 §4): rounded up, so a caller
 * never comes back early, and at least one.
 */
import { describe, expect, it } from 'vitest';

import { secondsUntil } from '../secondsUntil.js';

const NOW = Date.UTC(2026, 9, 2, 5, 0, 0);

describe('secondsUntil', () => {
    it.each<[string, number, number]>([
        ['a whole number of seconds away', 90_000, 90],
        ['part of a second past a whole one, rounded up', 90_001, 91],
        ['under a second away, as one', 10, 1],
        ['already past, as one', -5_000, 1],
    ])('answers an instant %s', (_label, offsetMs, seconds) => {
        expect(secondsUntil(new Date(NOW + offsetMs).toISOString(), NOW)).toBe(seconds);
    });

    it('refuses an instant it cannot read, rather than answering NaN', () => {
        expect(() => secondsUntil('soon', NOW)).toThrow(RangeError);
    });
});
