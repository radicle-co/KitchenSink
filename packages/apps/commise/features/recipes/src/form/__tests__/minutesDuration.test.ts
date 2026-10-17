/**
 * Unit tests for the minutes ↔ duration adapter: the draft stores prep and cook in whole MINUTES with 0 for "not
 * stated", and `DurationField` speaks SECONDS with `undefined` for "none" — so a 0 must show as an empty field, never
 * a "0" (`docs/design/uiOverhaul/buildSpec.md` §7.4).
 */
import { describe, expect, it } from 'vitest';

import { durationOfMinutes, minutesOfDuration } from '../minutesDuration.js';

describe('durationOfMinutes', () => {
    it('reads 0 minutes as no duration', () => {
        expect(durationOfMinutes(0)).toBeUndefined();
    });

    it('reads a negative as no duration', () => {
        expect(durationOfMinutes(-5)).toBeUndefined();
    });

    it('converts minutes to seconds', () => {
        expect(durationOfMinutes(90)).toBe(5400);
    });
});

describe('minutesOfDuration', () => {
    it('reads no duration as 0 minutes', () => {
        expect(minutesOfDuration(undefined)).toBe(0);
    });

    it('converts seconds to whole minutes', () => {
        expect(minutesOfDuration(5400)).toBe(90);
    });

    it('rounds a part minute', () => {
        expect(minutesOfDuration(89)).toBe(1);
    });

    it.each([1, 45, 60, 330])('round-trips %i minutes', (minutes) => {
        expect(minutesOfDuration(durationOfMinutes(minutes))).toBe(minutes);
    });
});
