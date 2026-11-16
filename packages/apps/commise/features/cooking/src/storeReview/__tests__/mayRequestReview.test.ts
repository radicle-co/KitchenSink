import { describe, expect, it } from 'vitest';

import { mayRequestReview, type ReviewPolicyInput } from '../mayRequestReview.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

/** An eligible cook: 2 finishes, account 30 days old, never asked, no running timer, nothing interrupted. */
function make(over: Partial<ReviewPolicyInput> = {}): ReviewPolicyInput {
    return {
        record: { finishes: 2 },
        accountCreatedAt: iso(NOW - 30 * DAY_MS),
        interrupted: false,
        soonestRunningMs: undefined,
        now: iso(NOW),
        ...over,
    };
}

describe('mayRequestReview (FR-036, plan 0011 KTD1)', () => {
    it('allows an eligible cook who was never asked', () => {
        expect(mayRequestReview(make())).toBe(true);
    });

    it('needs 2 finishes: 1 refuses, 2 allows', () => {
        expect(mayRequestReview(make({ record: { finishes: 1 } }))).toBe(false);
        expect(mayRequestReview(make({ record: { finishes: 2 } }))).toBe(true);
    });

    it('needs an account 7 x 24 h old: 1 ms short refuses, exactly 7 days allows', () => {
        expect(mayRequestReview(make({ accountCreatedAt: iso(NOW - 7 * DAY_MS + 1) }))).toBe(false);
        expect(mayRequestReview(make({ accountCreatedAt: iso(NOW - 7 * DAY_MS) }))).toBe(true);
    });

    it('needs 120 x 24 h since the last request: 1 ms short refuses, exactly 120 days allows', () => {
        const record = (at: number) => ({ finishes: 5, lastRequestAt: iso(at) });

        expect(mayRequestReview(make({ record: record(NOW - 120 * DAY_MS + 1) }))).toBe(false);
        expect(mayRequestReview(make({ record: record(NOW - 120 * DAY_MS) }))).toBe(true);
    });

    it('counts elapsed time, not calendar days, across a DST change', () => {
        // US spring-forward 2026-03-08: 7 calendar days later is 7 x 24 h minus an hour of elapsed time.
        const created = Date.parse('2026-03-01T12:00:00-05:00');
        const now = Date.parse('2026-03-08T12:00:00-04:00');

        expect(now - created).toBe(7 * DAY_MS - 60 * 60 * 1000);
        expect(mayRequestReview(make({ accountCreatedAt: iso(created), now: iso(now) }))).toBe(false);
    });

    it('refuses when the record is not loaded or corrupt (undefined), never reads it as never asked', () => {
        expect(mayRequestReview(make({ record: undefined }))).toBe(false);
    });

    it('refuses on an unknown or unparseable account date', () => {
        expect(mayRequestReview(make({ accountCreatedAt: undefined }))).toBe(false);
        expect(mayRequestReview(make({ accountCreatedAt: 'garbage' }))).toBe(false);
    });

    it('refuses on an unparseable clock or last-request date', () => {
        expect(mayRequestReview(make({ now: 'garbage' }))).toBe(false);
        expect(mayRequestReview(make({ record: { finishes: 2, lastRequestAt: 'garbage' } }))).toBe(false);
    });

    it('refuses a finishes count that is not a whole number of at least 2', () => {
        expect(mayRequestReview(make({ record: { finishes: Number.NaN } }))).toBe(false);
        expect(mayRequestReview(make({ record: { finishes: 2.5 } }))).toBe(false);
        expect(mayRequestReview(make({ record: { finishes: Number.POSITIVE_INFINITY } }))).toBe(false);
    });

    it('allows with a loaded record that has no lastRequestAt and 2 finishes', () => {
        expect(mayRequestReview(make({ record: { finishes: 2 } }))).toBe(true);
    });

    it('refuses while a running timer is within 30 s: 30,000 ms refuses, 30,001 ms allows, none allows', () => {
        expect(mayRequestReview(make({ soonestRunningMs: 30_000 }))).toBe(false);
        expect(mayRequestReview(make({ soonestRunningMs: 30_001 }))).toBe(true);
        expect(mayRequestReview(make({ soonestRunningMs: undefined }))).toBe(true);
    });

    it('refuses an overdue or unreadable timer distance', () => {
        expect(mayRequestReview(make({ soonestRunningMs: 0 }))).toBe(false);
        expect(mayRequestReview(make({ soonestRunningMs: -5_000 }))).toBe(false);
        expect(mayRequestReview(make({ soonestRunningMs: Number.NaN }))).toBe(false);
    });

    it('refuses when the clock was moved back: dates in the future never allow', () => {
        expect(mayRequestReview(make({ accountCreatedAt: iso(NOW + 8 * DAY_MS) }))).toBe(false);
        expect(mayRequestReview(make({ record: { finishes: 2, lastRequestAt: iso(NOW + 121 * DAY_MS) } }))).toBe(false);
    });

    it('refuses when another interruption owns the session', () => {
        expect(mayRequestReview(make({ interrupted: true }))).toBe(false);
    });
});
