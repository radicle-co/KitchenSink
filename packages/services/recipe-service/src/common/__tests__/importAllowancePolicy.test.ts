/**
 * The daily import allowance (004 FR-022, ADR-0072 §8), judged by one pure function.
 *
 * REWRITTEN for ADR-0072 §8 (owner ruling, 2026-10-26). The first version pinned ONE limit of 200 summed across every
 * channel, and "a bulk file is one unit". Both are wrong under the ruling, so those assertions are replaced, not
 * edited to compile: each channel now has its OWN limit and window (paste 200 a day, bulk 1,000 recipes a day), counts
 * ONLY its own rows, and a request larger than the room left is ADMITTED IN PART ("admit what fits"), because a file of
 * any size is accepted and the rest waits.
 *
 * Still pinned from the spec: a trailing 24 hours (plan.md §5), a refusal that names the moment more room opens
 * (FR-022), and the tier as a parameter that today changes nothing (the 010 seam).
 *
 * The edge rule is stated once in the policy and pinned from BOTH sides here: an event 24 h minus 1 ms old still
 * counts, an event exactly 24 h old does not.
 */
import { describe, expect, it } from 'vitest';

import {
    IMPORT_ALLOWANCE_RULES,
    evaluateImportAllowance,
    importAllowanceWindowStart,
    type AllowanceEvent,
} from '../importAllowancePolicy.js';
import type { ImportAllowanceChannel } from '../../database/schema/importAllowanceEvents.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const FREE = { isPremium: false } as const;
const PREMIUM = { isPremium: true } as const;
const HOUR = 3_600_000;

/** An event on `channel`, `ageMs` before NOW, spending `units`. */
function eventAged(ageMs: number, units = 1, channel: ImportAllowanceChannel = 'paste'): AllowanceEvent {
    return { channel, units, createdAt: new Date(NOW.getTime() - ageMs) };
}

/** `count` single-unit events on `channel`, `stepMs` apart starting `firstAgeMs` before NOW. */
function spread(count: number, firstAgeMs: number, stepMs: number, channel: ImportAllowanceChannel = 'paste') {
    return Array.from({ length: count }, (_unused, index) => eventAged(firstAgeMs - index * stepMs, 1, channel));
}

function decide(
    channel: ImportAllowanceChannel,
    windowEvents: readonly AllowanceEvent[],
    requestedUnits: number,
    now: Date = NOW,
    tier: { readonly isPremium: boolean } = FREE,
) {
    return evaluateImportAllowance({ channel, tier, windowEvents, requestedUnits, now });
}

describe('the allowance numbers (ADR-0072 §8; 004 FR-022 and plan.md §5)', () => {
    it('is 200 a rolling day for paste and 1,000 recipes a rolling day for bulk import', () => {
        expect(IMPORT_ALLOWANCE_RULES).toEqual({
            paste: { limit: 200, windowMs: 24 * HOUR },
            bulk: { limit: 1000, windowMs: 24 * HOUR },
        });
    });
});

describe('evaluateImportAllowance — paste', () => {
    it('admits a first paste', () => {
        expect(decide('paste', [], 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it('admits the 200th paste and refuses the 201st', () => {
        expect(decide('paste', spread(199, HOUR, 1000), 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('paste', spread(200, HOUR, 1000), 1).kind).toBe('refuse');
    });

    it('counts every event by its units, not by its row', () => {
        const events = [eventAged(1000, 150), eventAged(2000, 49)];

        expect(decide('paste', events, 1).kind).toBe('admit');
        // Two units asked, one left: admit what fits.
        expect(decide('paste', events, 2)).toMatchObject({ kind: 'partial', units: 1 });
    });
});

describe('evaluateImportAllowance — each channel counts only its own rows (ADR-0072 §8)', () => {
    it('does not charge a full paste allowance against bulk import', () => {
        expect(decide('bulk', spread(200, HOUR, 1000, 'paste'), 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it('does not charge a full bulk allowance against paste', () => {
        expect(decide('paste', [eventAged(HOUR, 1000, 'bulk')], 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it('does not let bulk rows shrink the paste room, or paste rows shrink the bulk room', () => {
        const mixed = [eventAged(HOUR, 199, 'paste'), eventAged(HOUR, 999, 'bulk')];

        expect(decide('paste', mixed, 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('bulk', mixed, 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('paste', mixed, 2)).toMatchObject({ kind: 'partial', units: 1 });
        expect(decide('bulk', mixed, 2)).toMatchObject({ kind: 'partial', units: 1 });
    });

    it('takes resetsAt from its own channel only', () => {
        // Paste is full with its oldest unit 20 h old. A very old bulk row must not become the reset instant.
        const events = [eventAged(23 * HOUR, 1, 'bulk'), eventAged(20 * HOUR, 1, 'paste'), ...spread(199, HOUR, 1000)];

        expect(decide('paste', events, 1)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + 4 * HOUR) });
    });
});

describe('evaluateImportAllowance — bulk admits what fits (ADR-0072 §8)', () => {
    it('admits a file that fits, whole', () => {
        expect(decide('bulk', [], 1000)).toEqual({ kind: 'admit', units: 1000 });
        expect(decide('bulk', [eventAged(HOUR, 400, 'bulk')], 600)).toEqual({ kind: 'admit', units: 600 });
    });

    it('accepts a file of any size: a 2,000-recipe export admits 1,000 and waits for the rest', () => {
        expect(decide('bulk', [], 2000)).toEqual({
            kind: 'partial',
            units: 1000,
            // The units admitted NOW are on the ledger at NOW, so the next room opens a day from now.
            resetsAt: new Date(NOW.getTime() + 24 * HOUR),
        });
    });

    it('admits the room that is left today and names when more opens', () => {
        const events = [eventAged(20 * HOUR, 300, 'bulk'), eventAged(2 * HOUR, 500, 'bulk')];

        expect(decide('bulk', events, 500)).toEqual({
            kind: 'partial',
            units: 200,
            // The oldest counted rows (300 units, 20 h old) leave in 4 h. The 200 admitted now do not matter.
            resetsAt: new Date(NOW.getTime() + 4 * HOUR),
        });
    });

    it('names resetsAt over the ledger PLUS the units being admitted now', () => {
        // The window is empty, 1,500 asked: 1,000 are written at NOW, so nothing frees before NOW + 24 h. Reading
        // resetsAt off the old ledger alone would find no event to wait for.
        const decision = decide('bulk', [], 1500);

        expect(decision).toMatchObject({ kind: 'partial', units: 1000 });

        if (decision.kind !== 'partial') {
            throw new Error('expected a partial admission');
        }

        expect(decision.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('refuses when no room is left, and names the first unit to leave', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(HOUR, 999, 'bulk')];

        expect(decide('bulk', events, 700)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + 4 * HOUR) });
    });

    it('does not make a request wait for enough units to leave: ONE freed unit reopens the allowance', () => {
        // ADR-0072 §8 admits what fits, so the allowance "reopens" the moment any unit frees, not when the whole
        // request would fit. (The old all-or-nothing rule waited for the whole request.)
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(10 * HOUR, 1, 'bulk'), eventAged(HOUR, 998, 'bulk')];

        expect(decide('bulk', events, 700)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + 4 * HOUR) });
    });

    it('is open at resetsAt and closed a millisecond before it', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(HOUR, 999, 'bulk')];
        const decision = decide('bulk', events, 5);

        if (decision.kind !== 'refuse') {
            throw new Error('expected a refusal');
        }

        expect(decide('bulk', events, 5, decision.resetsAt)).toMatchObject({ kind: 'partial', units: 1 });
        expect(decide('bulk', events, 5, new Date(decision.resetsAt.getTime() - 1)).kind).toBe('refuse');
    });

    it('does not depend on the order the events arrive in', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(10 * HOUR, 5, 'bulk'), eventAged(HOUR, 994, 'bulk')];

        expect(decide('bulk', [...events].reverse(), 7)).toEqual(decide('bulk', events, 7));
    });
});

describe('the window edge', () => {
    it.each(['paste', 'bulk'] as const)('%s: counts an event 24 h minus 1 ms old', (channel) => {
        const full = [
            eventAged(IMPORT_ALLOWANCE_RULES[channel].windowMs - 1, IMPORT_ALLOWANCE_RULES[channel].limit, channel),
        ];

        expect(decide(channel, full, 1).kind).toBe('refuse');
    });

    it.each(['paste', 'bulk'] as const)('%s: does not count an event exactly 24 h old', (channel) => {
        const full = [
            eventAged(IMPORT_ALLOWANCE_RULES[channel].windowMs, IMPORT_ALLOWANCE_RULES[channel].limit, channel),
        ];

        expect(decide(channel, full, 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it.each(['paste', 'bulk'] as const)('%s: does not count an event older than 24 h', (channel) => {
        const full = [
            eventAged(IMPORT_ALLOWANCE_RULES[channel].windowMs + 1, IMPORT_ALLOWANCE_RULES[channel].limit, channel),
        ];

        expect(decide(channel, full, 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it.each(['paste', 'bulk'] as const)('%s: exposes the same edge to the DAL', (channel) => {
        expect(importAllowanceWindowStart(channel, NOW).getTime()).toBe(
            NOW.getTime() - IMPORT_ALLOWANCE_RULES[channel].windowMs,
        );
    });
});

describe('resetsAt (paste)', () => {
    it('is the oldest counted event plus 24 h when the allowance is full', () => {
        const events = [eventAged(20 * HOUR), ...spread(199, HOUR, 1000)];

        expect(decide('paste', events, 1)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + 4 * HOUR) });
    });

    it('is strictly after now, and the allowance really is open at that moment', () => {
        const events = [eventAged(20 * HOUR), ...spread(199, HOUR, 1000)];
        const decision = decide('paste', events, 1);

        if (decision.kind !== 'refuse') {
            throw new Error('expected a refusal');
        }

        expect(decision.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
        expect(decide('paste', events, 1, decision.resetsAt)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('paste', events, 1, new Date(decision.resetsAt.getTime() - 1)).kind).toBe('refuse');
    });
});

describe('the tier parameter (the 010 seam)', () => {
    it.each([
        ['free', FREE],
        ['premium', PREMIUM],
    ])('gives a %s caller the same allowance today, on both channels', (_name, tier) => {
        expect(decide('paste', spread(199, HOUR, 1000), 1, NOW, tier)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('paste', spread(200, HOUR, 1000), 1, NOW, tier).kind).toBe('refuse');
        expect(decide('bulk', [eventAged(HOUR, 999, 'bulk')], 1, NOW, tier)).toEqual({ kind: 'admit', units: 1 });
        expect(decide('bulk', [eventAged(HOUR, 1000, 'bulk')], 1, NOW, tier).kind).toBe('refuse');
    });
});

describe('a request that is not a positive integer is a programmer error, not a refusal', () => {
    it.each([0, -1, 1.5, Number.NaN])('throws for requestedUnits = %s', (requestedUnits) => {
        expect(() => decide('bulk', [], requestedUnits)).toThrow(RangeError);
        expect(() => decide('paste', [], requestedUnits)).toThrow(RangeError);
    });
});
