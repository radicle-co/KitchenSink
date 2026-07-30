/**
 * Unit tests for locale-aware weekday labels.
 *
 * Requirement map:
 *  - FR-046 / R6 (CR-001) — the meal-plan skeleton shows REAL weekday names (only the meal is unknown), so
 *    the labels must be right, Monday-first, and must not break on a hostile locale tag.
 */
import { describe, expect, it } from 'vitest';

import { DAYS_PER_WEEK, weekdayLabels } from '../utils/weekdays.js';

describe('weekdayLabels', () => {
    it('returns exactly one label per day of the week', () => {
        expect(weekdayLabels('en')).toHaveLength(DAYS_PER_WEEK);
    });

    it('starts at Monday and ends at Sunday, matching the mockup strip', () => {
        expect(weekdayLabels('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    });

    it('localizes the labels rather than hard-coding English', () => {
        // The mutation lens: a hard-coded English array would still pass the 'en' case above.
        expect(weekdayLabels('fr')[0]).not.toBe('Mon');
        expect(weekdayLabels('de')).not.toEqual(weekdayLabels('en'));
    });

    it('emits no duplicate labels (an anchor/offset bug would repeat a day)', () => {
        expect(new Set(weekdayLabels('en')).size).toBe(DAYS_PER_WEEK);
    });

    it('degrades to the default locale on a malformed tag instead of throwing', () => {
        expect(() => weekdayLabels('not a locale!!')).not.toThrow();
        expect(weekdayLabels('not a locale!!')).toHaveLength(DAYS_PER_WEEK);
    });

    it('is pure — repeated calls yield equal labels', () => {
        expect(weekdayLabels('en')).toEqual(weekdayLabels('en'));
    });
});
