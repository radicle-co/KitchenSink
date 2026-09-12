/**
 * Unit tests for the version instant formatters — absolute and relative (`versions/timeFormat.ts`).
 *
 * ⚠️ These 2 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
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

    it('floors sub-minute elapsed time to "0 minutes ago" rather than surfacing seconds', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:30:00.000Z', new Date('2026-05-09T14:30:45.000Z'), 'en')).toBe(
            '0 minutes ago',
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

    it('never reports a negative/future elapsed time (clock skew degrades to "0 minutes ago")', () => {
        expect(formatRelativeTimeAgo('2026-05-09T14:35:00.000Z', new Date('2026-05-09T14:30:00.000Z'), 'en')).toBe(
            '0 minutes ago',
        );
    });
});
