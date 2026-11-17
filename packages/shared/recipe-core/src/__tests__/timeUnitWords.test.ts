/**
 * The time words are pinned as a literal list. The duration reader builds its pattern from `TIME_UNIT_WORDS` and the
 * step facts sheet reads its unit from it, so a test built from the same keys would pass after a key was deleted.
 */
import { describe, expect, it } from 'vitest';

import { LONG_TIME_UNIT_WORDS, SECONDS_PER_TIME_UNIT, TIME_UNIT_WORDS } from '../timeUnitWords.js';

describe('TIME_UNIT_WORDS', () => {
    it('is exactly the time words and the unit each names', () => {
        expect(TIME_UNIT_WORDS).toEqual({
            h: 'hour',
            hr: 'hour',
            hrs: 'hour',
            hour: 'hour',
            hours: 'hour',
            min: 'minute',
            mins: 'minute',
            minute: 'minute',
            minutes: 'minute',
            sec: 'second',
            secs: 'second',
            second: 'second',
            seconds: 'second',
        });
    });

    it('keeps days and weeks out of the list the duration reader reads', () => {
        expect(Object.keys(TIME_UNIT_WORDS)).not.toContain('day');
        expect(LONG_TIME_UNIT_WORDS).toEqual({ day: 'day', days: 'day', week: 'week', weeks: 'week' });
    });

    it('gives the seconds of every unit, written out', () => {
        expect(SECONDS_PER_TIME_UNIT).toEqual({ second: 1, minute: 60, hour: 3_600, day: 86_400, week: 604_800 });
    });
});
