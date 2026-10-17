/**
 * The pure hours/minutes arithmetic behind `DurationField` and every duration a cook reads (F1,
 * `docs/design/uiOverhaul/specRecipeAndWizard.md` S0.4). A step timer is STORED in seconds and was shown and entered
 * as seconds ("16200s timer"); people think in hours and minutes.
 *
 * The table is chosen to break the obvious wrong implementations: truncating instead of rounding (90 s, 5400 s),
 * rounding a short timer the cook set down to nothing (20 s, 59 s), and carrying minutes into hours (3570 s).
 */
import { describe, expect, it } from 'vitest';

import { durationBoxes, durationFromBoxes, joinDuration, splitDuration } from '../duration.js';

describe('splitDuration', () => {
    it.each([
        [undefined, undefined],
        [0, undefined],
        [-60, undefined],
        [20, { hours: 0, minutes: 1 }],
        [59, { hours: 0, minutes: 1 }],
        [60, { hours: 0, minutes: 1 }],
        [89, { hours: 0, minutes: 1 }],
        [90, { hours: 0, minutes: 2 }],
        [1800, { hours: 0, minutes: 30 }],
        [3570, { hours: 1, minutes: 0 }],
        [3599, { hours: 1, minutes: 0 }],
        [3600, { hours: 1, minutes: 0 }],
        [5400, { hours: 1, minutes: 30 }],
        [16200, { hours: 4, minutes: 30 }],
        [93600, { hours: 26, minutes: 0 }],
    ])('splits %s seconds into %o', (seconds, expected) => {
        expect(splitDuration(seconds)).toEqual(expected);
    });
});

describe('joinDuration', () => {
    it.each([
        [0, 0, undefined],
        [0, 1, 60],
        [1, 0, 3600],
        [4, 30, 16200],
        [0, 90, 5400],
    ])('joins %s h %s min into %s seconds', (hours, minutes, expected) => {
        expect(joinDuration(hours, minutes)).toBe(expected);
    });

    it('round-trips every whole-minute duration it produces', () => {
        for (const seconds of [60, 1800, 3600, 5400, 16200, 93600]) {
            const parts = splitDuration(seconds);
            expect(parts && joinDuration(parts.hours, parts.minutes)).toBe(seconds);
        }
    });
});

describe('durationBoxes — what the two boxes show', () => {
    it.each([
        [undefined, { hours: '', minutes: '' }],
        [1200, { hours: '', minutes: '20' }],
        [7200, { hours: '2', minutes: '' }],
        [16200, { hours: '4', minutes: '30' }],
    ])('shows %s seconds as %o (empty, never "0")', (seconds, expected) => {
        expect(durationBoxes(seconds)).toEqual(expected);
    });
});

describe('durationFromBoxes — what an edit stores', () => {
    it.each([
        ['', '', undefined],
        ['0', '0', undefined],
        ['4', '30', 16200],
        ['', '20', 1200],
        ['1', '', 3600],
        ['1', '-5', 3600],
        ['x', '5', 300],
        ['1.5', '0', 3600],
    ])('stores %j h %j min as %s seconds', (hours, minutes, expected) => {
        expect(durationFromBoxes(hours, minutes)).toBe(expected);
    });
});
