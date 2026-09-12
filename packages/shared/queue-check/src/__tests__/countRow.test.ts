import { describe, expect, it } from 'vitest';

import { countFrom, countsFrom } from '../countRow.js';

/**
 * ⛔ EVERY CASE HERE IS A WAY A BACKSTOP REPORTS A CLEAN BILL OF HEALTH WHILE WORK IS STUCK.
 *
 * The obvious unpacking — a cast plus `?? 0` — answers ZERO for a renamed column, an empty result set and a
 * driver returning something unexpected. `classifyOwed` reads zero as "nothing owed", so the check says
 * nothing and the stage looks exactly like one where nothing is wrong. A throw is loud instead: the handler
 * fails, the log names the column, and the missed cron check-in says the backstop is down.
 */
describe('reading a count off a row', () => {
    it('reads a number', () => {
        expect(countFrom({ stale_leases: 4 }, 'stale_leases')).toBe(4);
    });

    /**
     * ⚠️ `pg` returns `bigint` and `numeric` as STRINGS by default, and these counts are `::int` in SQL — so a
     * numeric string is the normal shape of a perfectly good value, and rejecting it would fail correct reads.
     */
    it('accepts the numeric string a driver may hand back for an integer column', () => {
        expect(countFrom({ stale_leases: '4' }, 'stale_leases')).toBe(4);
    });

    it('⛔ throws on a MISSING column rather than answering zero', () => {
        expect(() => countFrom({ other: 1 }, 'stale_leases')).toThrow(/null or absent stale_leases/u);
    });

    it('⛔ throws on an EMPTY result set rather than answering zero', () => {
        expect(() => countFrom(undefined, 'stale_leases')).toThrow(/no row/u);
        expect(() => countFrom(null, 'stale_leases')).toThrow(/no row/u);
    });

    /**
     * ⛔ EVERY VALUE HERE IS ONE `Number()` MAPS TO 0 OR 1 — `null`, `undefined`, `''`, `false`, `true`. Each
     * would sail through a `Number.isFinite` check as a plausible count, and the zero half is the answer that
     * says "nothing is owed". A `MAX()` over no rows without a `COALESCE` returns NULL, so this is the
     * ordinary shape of the mistake rather than an exotic one.
     */
    it('⛔ throws on every value Number() would silently turn into a count', () => {
        expect(() => countFrom({ stale_leases: 'four' }, 'stale_leases')).toThrow(/non-numeric/u);
        expect(() => countFrom({ stale_leases: null }, 'stale_leases')).toThrow(/null or absent/u);
        expect(() => countFrom({ stale_leases: undefined }, 'stale_leases')).toThrow(/null or absent/u);
        expect(() => countFrom({ stale_leases: '' }, 'stale_leases')).toThrow(/null or absent/u);
        expect(() => countFrom({ stale_leases: '   ' }, 'stale_leases')).toThrow(/null or absent/u);
        expect(() => countFrom({ stale_leases: false }, 'stale_leases')).toThrow(/non-numeric/u);
        expect(() => countFrom({ stale_leases: true }, 'stale_leases')).toThrow(/non-numeric/u);
        expect(() => countFrom({ stale_leases: [] }, 'stale_leases')).toThrow(/non-numeric/u);
    });

    /**
     * ⚠️ Zero is a real answer and must pass. A guard that rejected it would fire on every healthy read, which
     * is the failure mode one step over — a check nobody can keep green.
     */
    it('reads a genuine zero', () => {
        expect(countFrom({ stale_leases: 0 }, 'stale_leases')).toBe(0);
        expect(countFrom({ stale_leases: '0' }, 'stale_leases')).toBe(0);
    });
});

describe('reading several counts', () => {
    it('maps each field to its column', () => {
        expect(countsFrom({ a_col: 1, b_col: '2' }, { first: 'a_col', second: 'b_col' })).toEqual({
            first: 1,
            second: 2,
        });
    });

    it('⛔ throws on the first bad column rather than returning a partly-zero row', () => {
        expect(() => countsFrom({ a_col: 1 }, { first: 'a_col', second: 'b_col' })).toThrow(/absent b_col/u);
    });
});
