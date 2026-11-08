// @vitest-environment node
/**
 * The two numbers a developer can set for the parallel Playwright lanes. A typo must stop the run with a message that
 * names the variable: `Number('abc')` is NaN, and a NaN lane count or stagger fails somewhere far from the cause (or
 * worse, reads as "no limit").
 */
import { describe, expect, it } from 'vitest';

import { parseLaneRequest, parseStaggerSeconds } from '../e2eEnv';

describe('parseLaneRequest (E2E_LANES)', () => {
    it('is undefined when unset or empty: the planner chooses', () => {
        expect(parseLaneRequest({})).toBeUndefined();
        expect(parseLaneRequest({ E2E_LANES: '' })).toBeUndefined();
    });

    it.each([
        ['1', 1],
        ['4', 4],
        ['12', 12],
    ])('reads %s as %i', (text, count) => {
        expect(parseLaneRequest({ E2E_LANES: text })).toBe(count);
    });

    it.each(['0', '-1', '2.5', 'abc', ' 3', '3 ', '1e1', 'NaN', '08x'])('refuses %j, naming the variable', (text) => {
        expect(() => parseLaneRequest({ E2E_LANES: text })).toThrow(/E2E_LANES/u);
    });
});

describe('parseStaggerSeconds (E2E_LANE_STAGGER_SECONDS)', () => {
    it('defaults to 3 s, the gap that keeps lanes from signing in at once', () => {
        expect(parseStaggerSeconds({})).toBe(3);
        expect(parseStaggerSeconds({ E2E_LANE_STAGGER_SECONDS: '' })).toBe(3);
    });

    it.each([
        ['0', 0],
        ['1', 1],
        ['2.5', 2.5],
        ['30', 30],
    ])('reads %s as %d', (text, seconds) => {
        expect(parseStaggerSeconds({ E2E_LANE_STAGGER_SECONDS: text })).toBe(seconds);
    });

    it.each(['-1', 'abc', 'NaN', 'Infinity', ' 3', '1e400'])('refuses %j, naming the variable', (text) => {
        expect(() => parseStaggerSeconds({ E2E_LANE_STAGGER_SECONDS: text })).toThrow(/E2E_LANE_STAGGER_SECONDS/u);
    });
});
