/**
 * Unit tests for the version instant formatters — absolute and relative (`versions/timeFormat.ts`).
 */
import { describe, expect, it } from 'vitest';
import { formatRelativeTimeAgo, formatVersionTimestamp } from '../timeFormat.js';

describe('formatVersionTimestamp', () => {
    it('formats an ISO instant in UTC (timezone-independent) for the locale', () => {
        expect(formatVersionTimestamp('2026-04-01T09:00:00.000Z', 'en')).toContain('Apr 1, 2026');
    });
});

describe('formatRelativeTimeAgo (W7 Task 3 / X3)', () => {
    it('buckets to minutes under an hour', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:00.000Z', new Date('2026-05-09T14:32:00.000Z'), 'en')).toBe(
            '2 minutes ago',
        );
    });

    // P6 / E18 ("Edited 0 minutes ago"): under a minute the sentence says NOW, in the locale's own word, rather than a
    // count of zero. Seconds are never surfaced as a count.
    it.each([0, 1, 30, 59])('says it was just now when %s seconds have elapsed', (seconds) => {
        const saved = new Date('2026-05-09T14:30:00.000Z');
        const now = new Date(saved.getTime() + seconds * 1000);

        expect(formatRelativeTimeAgo(saved.toISOString(), now, 'en')).toBe('now');
    });

    it('says it in the locale’s own word', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:10.000Z', new Date('2026-05-09T14:30:20.000Z'), 'de')).toBe(
            'jetzt',
        );
    });

    it('turns to minutes at 60 seconds', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:00.000Z', new Date('2026-05-09T14:31:00.000Z'), 'en')).toBe(
            '1 minute ago',
        );
    });

    it('buckets to hours once an hour has elapsed', () => {
        expect(formatRelativeTimeAgo('2026-05-09T12:00:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '2 hours ago',
        );
    });

    it('buckets to days once a day has elapsed', () => {
        expect(formatRelativeTimeAgo('2026-05-07T14:30:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '2 days ago',
        );
    });

    it('says “yesterday” for one day, as a person would', () => {
        expect(formatRelativeTimeAgo('2026-05-08T14:30:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            'yesterday',
        );
    });

    it('never reports a future elapsed time (clock skew degrades to now)', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:35:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            'now',
        );
    });
});
