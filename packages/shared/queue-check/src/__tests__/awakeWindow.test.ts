/**
 * U11 — the awake window (R35).
 *
 * ⛔ ADR-0007 stops the sandbox tier from 00:00 to 09:00 America/New_York — RDS and the NAT instance both
 * go down. A backstop running in that window finds its database unreachable and every queue apparently
 * stalled, and escalates, every night, in every preview. A signal that fires nightly for a reason nobody can
 * act on is a signal its reader mutes, and the one time it means something is the night they do not look.
 */
import { describe, expect, it } from 'vitest';

import { isAwake, nightlyLocalHour, NIGHTLY_TIMEZONE } from '../awakeWindow.js';

/** An instant at a given UTC hour, on a date in the given half of the year. */
const utc = (iso: string): Date => new Date(iso);

describe('isAwake', () => {
    it('⛔ PROD is always awake — it is never stopped, and a clock must not hide a real outage', () => {
        expect(isAwake('prod', utc('2026-01-15T03:00:00Z'))).toBe(true);
        expect(isAwake('prod', utc('2026-07-15T06:00:00Z'))).toBe(true);
    });

    /**
     * ⛔ THE TIMEZONE IS PART OF THE DECISION. In January, New York is UTC-5, so 05:00 UTC is midnight local
     * — inside the closed window. In July it is UTC-4, so the SAME 05:00 UTC is 01:00 local, still closed,
     * while 04:00 UTC is midnight. Computing this in UTC would move the window an hour twice a year, in
     * opposite directions — so a suite written in one half of the year would pass while the other was wrong.
     */
    it('⛔ is CLOSED across the nightly window in winter (UTC-5)', () => {
        expect(isAwake('sandbox', utc('2026-01-15T05:00:00Z'))).toBe(false); // 00:00 local
        expect(isAwake('sandbox', utc('2026-01-15T13:59:00Z'))).toBe(false); // 08:59 local
        expect(isAwake('sandbox', utc('2026-01-15T14:00:00Z'))).toBe(true); // 09:00 local
    });

    it('⛔ is CLOSED across the same LOCAL window in summer (UTC-4) — the offset moved, the window did not', () => {
        expect(isAwake('sandbox', utc('2026-07-15T04:00:00Z'))).toBe(false); // 00:00 local
        expect(isAwake('sandbox', utc('2026-07-15T12:59:00Z'))).toBe(false); // 08:59 local
        expect(isAwake('sandbox', utc('2026-07-15T13:00:00Z'))).toBe(true); // 09:00 local
    });

    it('a preview follows the same window as sandbox — it shares the stopped tier', () => {
        expect(isAwake('pr-91', utc('2026-01-15T05:00:00Z'))).toBe(false);
        expect(isAwake('pr-91', utc('2026-01-15T20:00:00Z'))).toBe(true);
    });

    /**
     * ⚠️ Both daylight-saving transitions, at the instant they happen. 2026's US transitions are 8 March
     * (spring forward, 02:00 local skips to 03:00) and 1 November (fall back, 02:00 local repeats).
     */
    it('⛔ behaves across BOTH daylight-saving transitions', () => {
        // Spring forward: 06:59 UTC is 01:59 EST, still the closed window; 07:00 UTC is 03:00 EDT, closed.
        expect(isAwake('sandbox', utc('2026-03-08T06:59:00Z'))).toBe(false);
        expect(isAwake('sandbox', utc('2026-03-08T07:00:00Z'))).toBe(false);
        // ...and 13:00 UTC is 09:00 EDT — awake.
        expect(isAwake('sandbox', utc('2026-03-08T13:00:00Z'))).toBe(true);

        // Fall back: 05:00 UTC is 01:00 EDT and 06:00 UTC is 01:00 EST — the SAME local hour twice, both
        // inside the window, which is the case a UTC-offset implementation gets wrong in one of the two.
        expect(isAwake('sandbox', utc('2026-11-01T05:00:00Z'))).toBe(false);
        expect(isAwake('sandbox', utc('2026-11-01T06:00:00Z'))).toBe(false);
        expect(isAwake('sandbox', utc('2026-11-01T14:00:00Z'))).toBe(true); // 09:00 EST
    });
});

describe('nightlyLocalHour', () => {
    it('renders midnight as 0, never 24', () => {
        expect(nightlyLocalHour(utc('2026-01-15T05:00:00Z'))).toBe(0);
    });

    it('names the zone the scheduler itself uses', () => {
        expect(NIGHTLY_TIMEZONE).toBe('America/New_York');
    });
});
