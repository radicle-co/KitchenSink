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
 * (FR-022).
 *
 * REWRITTEN AGAIN for the owner's ruling of 2026-11-11: bulk import is 200 recipes a day on Free and 1,000 on a paid plan,
 * as ADR-0072 §8 says (the flat 1,000 was wrong). The bulk scope now carries `isPremium`, and the cases that pinned 1,000
 * name the paid plan; the Free boundary is pinned on its own. Paste is one limit for every plan and carries no plan.
 *
 * REWRITTEN AGAIN for the owner's ruling of 2026-11-15 ("one pipeline, one allowance"; test principals have no limit). The
 * editor's ingredient-list paste now draws on the ONE import allowance with bulk import: one rule (200 a day on Free,
 * 1,000 on a paid plan), every channel's rows count against it, and the paste scope carries the plan and the principal's
 * kind like bulk's. The block that pinned "each channel counts only its own rows" is replaced by one that pins the
 * opposite, because that is the ruling, not an accident of the code.
 *
 * The edge rule is stated once in the policy and pinned from BOTH sides here: an event 24 h minus 1 ms old still
 * counts, an event exactly 24 h old does not.
 */
import { describe, expect, it } from 'vitest';

import {
    IMPORT_ALLOWANCE_RULE,
    TEST_PRINCIPAL_ALLOWANCE_LIMIT,
    describeImportAllowance,
    evaluateImportAllowance,
    importAllowanceLimitOf,
    importAllowanceWindowStart,
    type AllowanceEvent,
    type ImportAllowanceScope,
} from '../importAllowancePolicy.js';
import type { ImportAllowanceChannel } from '../../database/schema/importAllowanceEvents.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const HOUR = 3_600_000;

/** An event on `channel`, `ageMs` before NOW, spending `units`. */
function eventAged(ageMs: number, units = 1, channel: ImportAllowanceChannel = 'paste'): AllowanceEvent {
    return { channel, units, createdAt: new Date(NOW.getTime() - ageMs) };
}

/** `count` single-unit events on `channel`, `stepMs` apart starting `firstAgeMs` before NOW. */
function spread(count: number, firstAgeMs: number, stepMs: number, channel: ImportAllowanceChannel = 'paste') {
    return Array.from({ length: count }, (_unused, index) => eventAged(firstAgeMs - index * stepMs, 1, channel));
}

const PASTE: ImportAllowanceScope = { channel: 'paste', isPremium: false, principalKind: 'real' };
const PASTE_PAID: ImportAllowanceScope = { channel: 'paste', isPremium: true, principalKind: 'real' };
const PASTE_TEST: ImportAllowanceScope = { channel: 'paste', isPremium: false, principalKind: 'test' };
const BULK_FREE: ImportAllowanceScope = { channel: 'bulk', isPremium: false, principalKind: 'real' };
const BULK_PAID: ImportAllowanceScope = { channel: 'bulk', isPremium: true, principalKind: 'real' };
const BULK_TEST: ImportAllowanceScope = { channel: 'bulk', isPremium: false, principalKind: 'test' };
/** The scope each channel's shared cases run under: bulk on the paid plan, whose limit the cases were written for. */
const SCOPE_OF = { paste: PASTE, bulk: BULK_PAID } as const;

function decide(
    scope: ImportAllowanceScope,
    windowEvents: readonly AllowanceEvent[],
    requestedUnits: number,
    now = NOW,
) {
    return evaluateImportAllowance({ ...scope, windowEvents, requestedUnits, now });
}

describe('the allowance numbers (ADR-0072 §8; 004 FR-022 and FR-067)', () => {
    it('is ONE rule for every channel: 200 a rolling day on Free and 1,000 on a paid plan', () => {
        expect(IMPORT_ALLOWANCE_RULE).toEqual({ limit: { free: 200, paid: 1000 }, windowMs: 24 * HOUR });
        expect([
            importAllowanceLimitOf(PASTE),
            importAllowanceLimitOf(PASTE_PAID),
            importAllowanceLimitOf(BULK_FREE),
            importAllowanceLimitOf(BULK_PAID),
        ]).toEqual([200, 1000, 200, 1000]);
    });

    it('⛔ gives a test principal no limit on any channel (owner ruling 2026-11-15)', () => {
        expect([importAllowanceLimitOf(PASTE_TEST), importAllowanceLimitOf(BULK_TEST)]).toEqual([
            TEST_PRINCIPAL_ALLOWANCE_LIMIT,
            TEST_PRINCIPAL_ALLOWANCE_LIMIT,
        ]);
        expect(decide(PASTE_TEST, [eventAged(HOUR, 5000, 'paste')], 1)).toEqual({ kind: 'admit', units: 1 });
    });
});

describe('⛔ the bulk limit follows the plan (owner ruling 2026-11-11)', () => {
    it('admits the 200th recipe on Free and refuses the 201st', () => {
        expect(decide(BULK_FREE, [eventAged(HOUR, 199, 'bulk')], 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(BULK_FREE, [eventAged(HOUR, 200, 'bulk')], 1).kind).toBe('refuse');
    });

    it('admits the 1,000th recipe on a paid plan and refuses the 1,001st', () => {
        expect(decide(BULK_PAID, [eventAged(HOUR, 999, 'bulk')], 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(BULK_PAID, [eventAged(HOUR, 1000, 'bulk')], 1).kind).toBe('refuse');
    });

    it('admits what fits on Free: a 500-recipe file takes 200 today', () => {
        expect(decide(BULK_FREE, [], 500)).toMatchObject({ kind: 'partial', units: 200 });
    });

    it('reports the plan’s own limit in the view', () => {
        expect(describeImportAllowance({ ...BULK_FREE, windowEvents: [], now: NOW }).limit).toBe(200);
        expect(describeImportAllowance({ ...BULK_PAID, windowEvents: [], now: NOW }).limit).toBe(1000);
    });
});

describe('evaluateImportAllowance — paste', () => {
    it('admits a first paste', () => {
        expect(decide(PASTE, [], 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it('admits the 200th paste and refuses the 201st', () => {
        expect(decide(PASTE, spread(199, HOUR, 1000), 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(PASTE, spread(200, HOUR, 1000), 1).kind).toBe('refuse');
    });

    it('counts every event by its units, not by its row', () => {
        const events = [eventAged(1000, 150), eventAged(2000, 49)];

        expect(decide(PASTE, events, 1).kind).toBe('admit');
        // Two units asked, one left: admit what fits.
        expect(decide(PASTE, events, 2)).toMatchObject({ kind: 'partial', units: 1 });
    });
});

describe('⛔ evaluateImportAllowance — every channel draws on the ONE allowance (owner ruling 2026-11-15)', () => {
    it('refuses a paste once bulk import has spent the allowance', () => {
        expect(decide(PASTE, [eventAged(HOUR, 200, 'bulk')], 1).kind).toBe('refuse');
        expect(decide(PASTE_PAID, [eventAged(HOUR, 1000, 'bulk')], 1).kind).toBe('refuse');
    });

    it('refuses bulk import once pastes have spent the allowance', () => {
        expect(decide(BULK_FREE, spread(200, HOUR, 1000, 'paste'), 1).kind).toBe('refuse');
    });

    it('sums both channels’ rows against the one limit', () => {
        const mixed = [eventAged(HOUR, 120, 'paste'), eventAged(HOUR, 79, 'bulk')];

        expect(decide(PASTE, mixed, 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(BULK_FREE, mixed, 2)).toMatchObject({ kind: 'partial', units: 1 });
        expect(decide(PASTE, [...mixed, eventAged(HOUR, 1, 'bulk')], 1).kind).toBe('refuse');
    });

    it('takes resetsAt from the oldest unit on any channel', () => {
        // Full on Free; the oldest unit is a bulk row 23 h old, so one unit frees in 1 h.
        const events = [eventAged(23 * HOUR, 1, 'bulk'), ...spread(199, HOUR, 1000)];

        expect(decide(PASTE, events, 1)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + HOUR) });
    });
});

describe('evaluateImportAllowance — bulk admits what fits (ADR-0072 §8)', () => {
    it('admits a file that fits, whole', () => {
        expect(decide(BULK_PAID, [], 1000)).toEqual({ kind: 'admit', units: 1000 });
        expect(decide(BULK_PAID, [eventAged(HOUR, 400, 'bulk')], 600)).toEqual({ kind: 'admit', units: 600 });
    });

    it('accepts a file of any size: a 2,000-recipe export admits 1,000 and waits for the rest', () => {
        expect(decide(BULK_PAID, [], 2000)).toEqual({
            kind: 'partial',
            units: 1000,
            // The units admitted NOW are on the ledger at NOW, so the next room opens a day from now.
            resetsAt: new Date(NOW.getTime() + 24 * HOUR),
        });
    });

    it('admits the room that is left today and names when more opens', () => {
        const events = [eventAged(20 * HOUR, 300, 'bulk'), eventAged(2 * HOUR, 500, 'bulk')];

        expect(decide(BULK_PAID, events, 500)).toEqual({
            kind: 'partial',
            units: 200,
            // The oldest counted rows (300 units, 20 h old) leave in 4 h. The 200 admitted now do not matter.
            resetsAt: new Date(NOW.getTime() + 4 * HOUR),
        });
    });

    it('names resetsAt over the ledger PLUS the units being admitted now', () => {
        // The window is empty, 1,500 asked: 1,000 are written at NOW, so nothing frees before NOW + 24 h. Reading
        // resetsAt off the old ledger alone would find no event to wait for.
        const decision = decide(BULK_PAID, [], 1500);

        expect(decision).toMatchObject({ kind: 'partial', units: 1000 });

        if (decision.kind !== 'partial') {
            throw new Error('expected a partial admission');
        }

        expect(decision.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('refuses when no room is left, and names the first unit to leave', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(HOUR, 999, 'bulk')];

        expect(decide(BULK_PAID, events, 700)).toEqual({
            kind: 'refuse',
            resetsAt: new Date(NOW.getTime() + 4 * HOUR),
        });
    });

    it('does not make a request wait for enough units to leave: ONE freed unit reopens the allowance', () => {
        // ADR-0072 §8 admits what fits, so the allowance "reopens" the moment any unit frees, not when the whole
        // request would fit. (The old all-or-nothing rule waited for the whole request.)
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(10 * HOUR, 1, 'bulk'), eventAged(HOUR, 998, 'bulk')];

        expect(decide(BULK_PAID, events, 700)).toEqual({
            kind: 'refuse',
            resetsAt: new Date(NOW.getTime() + 4 * HOUR),
        });
    });

    it('is open at resetsAt and closed a millisecond before it', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(HOUR, 999, 'bulk')];
        const decision = decide(BULK_PAID, events, 5);

        if (decision.kind !== 'refuse') {
            throw new Error('expected a refusal');
        }

        expect(decide(BULK_PAID, events, 5, decision.resetsAt)).toMatchObject({ kind: 'partial', units: 1 });
        expect(decide(BULK_PAID, events, 5, new Date(decision.resetsAt.getTime() - 1)).kind).toBe('refuse');
    });

    it('does not depend on the order the events arrive in', () => {
        const events = [eventAged(20 * HOUR, 1, 'bulk'), eventAged(10 * HOUR, 5, 'bulk'), eventAged(HOUR, 994, 'bulk')];

        expect(decide(BULK_PAID, [...events].reverse(), 7)).toEqual(decide(BULK_PAID, events, 7));
    });
});

describe('the window edge', () => {
    it.each(['paste', 'bulk'] as const)('%s: counts an event 24 h minus 1 ms old', (channel) => {
        const full = [
            eventAged(IMPORT_ALLOWANCE_RULE.windowMs - 1, importAllowanceLimitOf(SCOPE_OF[channel]), channel),
        ];

        expect(decide(SCOPE_OF[channel], full, 1).kind).toBe('refuse');
    });

    it.each(['paste', 'bulk'] as const)('%s: does not count an event exactly 24 h old', (channel) => {
        const full = [eventAged(IMPORT_ALLOWANCE_RULE.windowMs, importAllowanceLimitOf(SCOPE_OF[channel]), channel)];

        expect(decide(SCOPE_OF[channel], full, 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it.each(['paste', 'bulk'] as const)('%s: does not count an event older than 24 h', (channel) => {
        const full = [
            eventAged(IMPORT_ALLOWANCE_RULE.windowMs + 1, importAllowanceLimitOf(SCOPE_OF[channel]), channel),
        ];

        expect(decide(SCOPE_OF[channel], full, 1)).toEqual({ kind: 'admit', units: 1 });
    });

    it('exposes the same edge to the DAL', () => {
        expect(importAllowanceWindowStart(NOW).getTime()).toBe(NOW.getTime() - IMPORT_ALLOWANCE_RULE.windowMs);
    });
});

describe('resetsAt (paste)', () => {
    it('is the oldest counted event plus 24 h when the allowance is full', () => {
        const events = [eventAged(20 * HOUR), ...spread(199, HOUR, 1000)];

        expect(decide(PASTE, events, 1)).toEqual({ kind: 'refuse', resetsAt: new Date(NOW.getTime() + 4 * HOUR) });
    });

    it('is strictly after now, and the allowance really is open at that moment', () => {
        const events = [eventAged(20 * HOUR), ...spread(199, HOUR, 1000)];
        const decision = decide(PASTE, events, 1);

        if (decision.kind !== 'refuse') {
            throw new Error('expected a refusal');
        }

        expect(decision.resetsAt.getTime()).toBeGreaterThan(NOW.getTime());
        expect(decide(PASTE, events, 1, decision.resetsAt)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(PASTE, events, 1, new Date(decision.resetsAt.getTime() - 1)).kind).toBe('refuse');
    });
});

describe('the limits on each channel', () => {
    it('allows 200 paste units and 1000 paid bulk units in the window, and one more is refused', () => {
        expect(decide(PASTE, spread(199, HOUR, 1000), 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(PASTE, spread(200, HOUR, 1000), 1).kind).toBe('refuse');
        expect(decide(BULK_PAID, [eventAged(HOUR, 999, 'bulk')], 1)).toEqual({ kind: 'admit', units: 1 });
        expect(decide(BULK_PAID, [eventAged(HOUR, 1000, 'bulk')], 1).kind).toBe('refuse');
    });
});

describe('a request that is not a positive integer is a programmer error, not a refusal', () => {
    it.each([0, -1, 1.5, Number.NaN])('throws for requestedUnits = %s', (requestedUnits) => {
        expect(() => decide(BULK_PAID, [], requestedUnits)).toThrow(RangeError);
        expect(() => decide(PASTE, [], requestedUnits)).toThrow(RangeError);
    });
});

describe('describeImportAllowance — the state the import view shows (ADR-0072 §8, as amended: advance answers 200)', () => {
    const describeAt = (channel: ImportAllowanceChannel, windowEvents: readonly AllowanceEvent[], now: Date = NOW) =>
        describeImportAllowance({ ...SCOPE_OF[channel], windowEvents, now });

    it('says nothing is spent and nothing resets for an empty ledger', () => {
        expect(describeAt('bulk', [])).toStrictEqual({ limit: 1000, used: 0, resetsAt: null });
    });

    it('sums every channel’s units in the window: the view shows the one allowance', () => {
        expect(describeAt('bulk', [eventAged(HOUR, 30, 'bulk'), eventAged(HOUR, 99, 'paste')]).used).toBe(129);
        expect(describeAt('paste', [eventAged(HOUR, 30, 'bulk'), eventAged(HOUR, 99, 'paste')]).used).toBe(129);
    });

    it('reports the plan’s limit on every channel', () => {
        expect(describeAt('bulk', []).limit).toBe(IMPORT_ALLOWANCE_RULE.limit.paid);
        expect(describeImportAllowance({ ...PASTE, windowEvents: [], now: NOW }).limit).toBe(
            IMPORT_ALLOWANCE_RULE.limit.free,
        );
    });

    it('resets when the OLDEST counted event leaves the window', () => {
        const oldest = eventAged(5 * HOUR, 10, 'bulk');
        const result = describeAt('bulk', [eventAged(HOUR, 4, 'bulk'), oldest]);

        expect(result.resetsAt).toBe(
            new Date(oldest.createdAt.getTime() + IMPORT_ALLOWANCE_RULE.windowMs).toISOString(),
        );
    });

    it('does not count an event at or past the window edge (the same edge the decision uses)', () => {
        const windowMs = IMPORT_ALLOWANCE_RULE.windowMs;

        expect(describeAt('bulk', [eventAged(windowMs, 5, 'bulk')])).toStrictEqual({
            limit: 1000,
            used: 0,
            resetsAt: null,
        });
        expect(describeAt('bulk', [eventAged(windowMs - 1, 5, 'bulk')]).used).toBe(5);
    });

    it('shows a spent allowance as used equal to the limit, with the moment more opens', () => {
        const result = describeAt('bulk', [eventAged(2 * HOUR, 1000, 'bulk')]);

        expect(result.used).toBe(result.limit);
        expect(result.resetsAt).not.toBeNull();
    });

    // Over the limit, ONE unit of room needs more than the oldest event to leave. The view must name the same moment the
    // next advance's refusal names, or the cook is told to come back before the import will move.
    it('⛔ over the limit, names the same moment the refusal does, not the oldest event', () => {
        // 1,005 spent: six units must leave, and the oldest event holds only one of them.
        const events = [eventAged(5 * HOUR, 1, 'bulk'), eventAged(3 * HOUR, 1004, 'bulk')];
        const refusal = decide(BULK_PAID, events, 1);

        expect(refusal.kind).toBe('refuse');
        expect(describeAt('bulk', events).resetsAt).toBe(
            refusal.kind === 'refuse' ? refusal.resetsAt.toISOString() : 'not refused',
        );
    });

    // The plan's limit flows through the ONE counting step, so the Free view and the Free refusal agree as well.
    it('⛔ on Free, reads the Free limit and names the moment the Free refusal names', () => {
        // 205 spent on Free: six units must leave, and the oldest event holds only one of them.
        const events = [eventAged(5 * HOUR, 1, 'bulk'), eventAged(3 * HOUR, 204, 'bulk')];
        const refusal = decide(BULK_FREE, events, 1);
        const view = describeImportAllowance({ ...BULK_FREE, windowEvents: events, now: NOW });

        expect(refusal.kind).toBe('refuse');
        expect(view.limit).toBe(200);
        expect(view.used).toBe(205);
        expect(view.resetsAt).toBe(refusal.kind === 'refuse' ? refusal.resetsAt.toISOString() : 'not refused');
    });
});

// Owner ruling 2026-11-15: "if this is for testing, then there are no limits. IF this is for user-facing behavior, then
// one pipeline, one allowance." A test principal (ADR-0040) is the testing; a real cook is the user-facing behaviour.
describe('a test principal has no limit (owner ruling 2026-11-15)', () => {
    it('⛔ admits a request however much the window already holds', () => {
        const events = [eventAged(HOUR, 50_000, 'bulk')];

        expect(decide(BULK_TEST, events, 1_000)).toEqual({ kind: 'admit', units: 1_000 });
        // The same ledger refuses a real cook on either plan: the difference is the principal, not the data.
        expect(decide(BULK_PAID, events, 1).kind).toBe('refuse');
        expect(decide(BULK_FREE, events, 1).kind).toBe('refuse');
    });

    it('states its limit as the int4 ceiling the view contract can carry, and is never "spent" at ordinary volume', () => {
        const view = describeImportAllowance({
            ...BULK_TEST,
            windowEvents: [eventAged(HOUR, 50_000, 'bulk')],
            now: NOW,
        });

        expect(importAllowanceLimitOf(BULK_TEST)).toBe(TEST_PRINCIPAL_ALLOWANCE_LIMIT);
        expect(view.limit).toBe(TEST_PRINCIPAL_ALLOWANCE_LIMIT);
        expect(view.used).toBeLessThan(view.limit);
    });

    it('a real cook on the same scope shape keeps the plan limit', () => {
        expect(importAllowanceLimitOf(BULK_FREE)).toBe(200);
        expect(importAllowanceLimitOf(BULK_PAID)).toBe(1000);
    });
});
