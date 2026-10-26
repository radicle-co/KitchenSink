/**
 * The daily import allowance (004 FR-022), judged by one pure function.
 *
 * Written from the spec and plan, before the policy existed: 200 imports a day per user across all channels, a
 * trailing 24 hours (plan.md §5, "Rate limiting and backpressure"), a refusal that names the moment the allowance
 * reopens (FR-022), and the tier as a parameter that today changes nothing (the 010 seam).
 *
 * The edge rule is stated once in the policy and pinned from BOTH sides here: an event 24 h minus 1 ms old still
 * counts, an event exactly 24 h old does not.
 */
import { describe, expect, it } from 'vitest';

import {
    IMPORT_ALLOWANCE_DAILY_LIMIT,
    IMPORT_ALLOWANCE_WINDOW_MS,
    evaluateImportAllowance,
    importAllowanceWindowStart,
    type AllowanceEvent,
} from '../importAllowancePolicy.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const FREE = { isPremium: false } as const;
const PREMIUM = { isPremium: true } as const;

/** An event `ageMs` before NOW, spending `units`. */
function eventAged(ageMs: number, units = 1): AllowanceEvent {
    return { units, createdAt: new Date(NOW.getTime() - ageMs) };
}

/** `count` single-unit events, `ageMs` apart starting `firstAgeMs` before NOW (oldest last in time order). */
function spread(count: number, firstAgeMs: number, stepMs: number): AllowanceEvent[] {
    return Array.from({ length: count }, (_unused, index) => eventAged(firstAgeMs - index * stepMs));
}

describe('the allowance numbers (004 FR-022, plan.md §5)', () => {
    it('is 200 a day over a trailing 24 hours', () => {
        expect(IMPORT_ALLOWANCE_DAILY_LIMIT).toBe(200);
        expect(IMPORT_ALLOWANCE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });
});

describe('evaluateImportAllowance', () => {
    it('admits a first import', () => {
        expect(evaluateImportAllowance({ tier: FREE, windowEvents: [], requestedUnits: 1, now: NOW })).toEqual({
            kind: 'admit',
        });
    });

    it('admits the 200th unit and refuses the 201st', () => {
        const spent199 = spread(199, 3_600_000, 1000);
        const spent200 = spread(200, 3_600_000, 1000);

        expect(evaluateImportAllowance({ tier: FREE, windowEvents: spent199, requestedUnits: 1, now: NOW })).toEqual({
            kind: 'admit',
        });
        expect(evaluateImportAllowance({ tier: FREE, windowEvents: spent200, requestedUnits: 1, now: NOW }).kind).toBe(
            'refuse',
        );
    });

    it('counts every event by its units, not by its row', () => {
        // One bulk file is ONE unit (D-013), but a multi-unit row must weigh what it says.
        const events = [eventAged(1000, 150), eventAged(2000, 49)];

        expect(evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 1, now: NOW }).kind).toBe(
            'admit',
        );
        expect(evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 2, now: NOW }).kind).toBe(
            'refuse',
        );
    });

    describe('the window edge', () => {
        it('counts an event 24 h minus 1 ms old', () => {
            const full = [eventAged(IMPORT_ALLOWANCE_WINDOW_MS - 1, IMPORT_ALLOWANCE_DAILY_LIMIT)];

            expect(evaluateImportAllowance({ tier: FREE, windowEvents: full, requestedUnits: 1, now: NOW }).kind).toBe(
                'refuse',
            );
        });

        it('does not count an event exactly 24 h old', () => {
            const full = [eventAged(IMPORT_ALLOWANCE_WINDOW_MS, IMPORT_ALLOWANCE_DAILY_LIMIT)];

            expect(evaluateImportAllowance({ tier: FREE, windowEvents: full, requestedUnits: 1, now: NOW })).toEqual({
                kind: 'admit',
            });
        });

        it('does not count an event older than 24 h', () => {
            const full = [eventAged(IMPORT_ALLOWANCE_WINDOW_MS + 1, IMPORT_ALLOWANCE_DAILY_LIMIT)];

            expect(evaluateImportAllowance({ tier: FREE, windowEvents: full, requestedUnits: 1, now: NOW })).toEqual({
                kind: 'admit',
            });
        });

        it('exposes the same edge to the DAL as the moment an event stops counting', () => {
            expect(importAllowanceWindowStart(NOW).getTime()).toBe(NOW.getTime() - IMPORT_ALLOWANCE_WINDOW_MS);
        });
    });

    describe('resetsAt', () => {
        it('is the oldest counted event plus 24 h when one unit must free up', () => {
            // 200 units spent; the oldest was 20 h ago, so it leaves the window 4 h from now.
            const events = [eventAged(20 * 3_600_000), ...spread(199, 3_600_000, 1000)];
            const decision = evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 1, now: NOW });

            expect(decision).toEqual({
                kind: 'refuse',
                resetsAt: new Date(NOW.getTime() + 4 * 3_600_000),
            });
        });

        it('does not depend on the order the events arrive in', () => {
            const events = [eventAged(20 * 3_600_000), ...spread(199, 3_600_000, 1000)];
            const forward = evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 1, now: NOW });
            const reversed = evaluateImportAllowance({
                tier: FREE,
                windowEvents: [...events].reverse(),
                requestedUnits: 1,
                now: NOW,
            });

            expect(reversed).toEqual(forward);
        });

        it('waits for enough units to leave, not merely the first event', () => {
            // Two units on the books at 20 h and 10 h; limit consumed by a 198-unit event 1 h ago. A request for 2 needs
            // BOTH old units to leave, so the allowance reopens when the 10 h-old one does, not the 20 h-old one.
            const events = [eventAged(20 * 3_600_000, 1), eventAged(10 * 3_600_000, 1), eventAged(3_600_000, 198)];
            const decision = evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 2, now: NOW });

            expect(decision).toEqual({
                kind: 'refuse',
                resetsAt: new Date(NOW.getTime() + 14 * 3_600_000),
            });
        });

        it('is strictly after now, and the allowance really is open at that moment', () => {
            const events = [eventAged(20 * 3_600_000), ...spread(199, 3_600_000, 1000)];
            const decision = evaluateImportAllowance({ tier: FREE, windowEvents: events, requestedUnits: 1, now: NOW });

            if (decision.kind !== 'refuse') {
                throw new Error('expected a refusal');
            }

            expect(decision.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
            expect(
                evaluateImportAllowance({
                    tier: FREE,
                    windowEvents: events,
                    requestedUnits: 1,
                    now: decision.resetsAt,
                }),
            ).toEqual({ kind: 'admit' });
            expect(
                evaluateImportAllowance({
                    tier: FREE,
                    windowEvents: events,
                    requestedUnits: 1,
                    now: new Date(decision.resetsAt.getTime() - 1),
                }).kind,
            ).toBe('refuse');
        });
    });

    describe('the tier parameter (the 010 seam)', () => {
        it.each([
            ['free', FREE],
            ['premium', PREMIUM],
        ])('gives a %s caller the same allowance today', (_name, tier) => {
            const spent200 = spread(200, 3_600_000, 1000);

            expect(
                evaluateImportAllowance({
                    tier,
                    windowEvents: spread(199, 3_600_000, 1000),
                    requestedUnits: 1,
                    now: NOW,
                }),
            ).toEqual({
                kind: 'admit',
            });
            expect(evaluateImportAllowance({ tier, windowEvents: spent200, requestedUnits: 1, now: NOW }).kind).toBe(
                'refuse',
            );
        });
    });

    describe('a request that can never be admitted is a programmer error, not a refusal', () => {
        it.each([0, -1, 1.5, IMPORT_ALLOWANCE_DAILY_LIMIT + 1])('throws for requestedUnits = %s', (requestedUnits) => {
            expect(() => evaluateImportAllowance({ tier: FREE, windowEvents: [], requestedUnits, now: NOW })).toThrow(
                RangeError,
            );
        });
    });
});
