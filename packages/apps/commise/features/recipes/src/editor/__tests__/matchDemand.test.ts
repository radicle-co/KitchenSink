/**
 * Unit tests for `matchDemand.ts`: WHEN the paste host asks recipe-service for matches (ADR-0071 section 4/9: the call is
 * idempotent and made from the poll loop "when newly parsed lines appear"). Written from that rule, seen red first.
 *
 * A food needs a request only while it has NO match (`match` null or absent). A `checking` food already has one: the
 * poll refreshes it, asking again would be a second request for nothing.
 */
import { describe, expect, it } from 'vitest';

import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import { shouldRequestMatches, unmatchedFoodRefsOf } from '../matchDemand.js';

const MATCH = { state: 'confident', reason: 'exactName', proposed: null, candidates: [] } as const;

const food = (match?: object | null) => ({ name: 'flour', prep: null, ...(match === undefined ? {} : { match }) });

const lineOf = (
    lineIndex: number,
    status: 'pending' | 'parsed' | 'withdrawn' | 'unparseable' | 'failed_retryable',
    foods?: readonly object[],
) => ({
    lineIndex,
    sourceLine: `line ${lineIndex}`,
    status,
    progress: null,
    proposal:
        foods === undefined
            ? null
            : { raw: `line ${lineIndex}`, quantity: null, unit: null, statedMeasure: null, foods, reviewReasons: [] },
});

const jobOf = (...lines: ReturnType<typeof lineOf>[]) => ({ lines }) as unknown as ParseJobResponse;

describe('unmatchedFoodRefsOf', () => {
    it('lists each parsed food with no match, in paste order, keyed lineIndex:foodIndex', () => {
        const job = jobOf(
            lineOf(0, 'parsed', [food(MATCH)]),
            lineOf(1, 'parsed', [food(null), food(MATCH), food()]),
            lineOf(2, 'parsed', [food(null)]),
        );

        expect(unmatchedFoodRefsOf(job)).toEqual([
            { key: '1:0', lineIndex: 1, foodIndex: 0 },
            { key: '1:2', lineIndex: 1, foodIndex: 2 },
            { key: '2:0', lineIndex: 2, foodIndex: 0 },
        ]);
    });

    it('does not list a food that is checking: it has a match, and the poll refreshes it', () => {
        const job = jobOf(lineOf(0, 'parsed', [food({ ...MATCH, state: 'checking' })]));

        expect(unmatchedFoodRefsOf(job)).toEqual([]);
    });

    it('lists nothing for lines that carry no proposal', () => {
        const job = jobOf(
            lineOf(0, 'pending'),
            lineOf(1, 'withdrawn'),
            lineOf(2, 'unparseable'),
            lineOf(3, 'failed_retryable'),
        );

        expect(unmatchedFoodRefsOf(job)).toEqual([]);
    });
});

describe('shouldRequestMatches', () => {
    const ref = (key: string) => ({ key, lineIndex: Number(key.split(':')[0]), foodIndex: Number(key.split(':')[1]) });

    it('asks the first time anything is unmatched', () => {
        expect(shouldRequestMatches(new Set(), [ref('0:0')], false)).toBe(true);
    });

    it('does not ask when nothing is unmatched', () => {
        expect(shouldRequestMatches(new Set(['0:0']), [], false)).toBe(false);
        expect(shouldRequestMatches(new Set(), [], false)).toBe(false);
    });

    it('does not ask again for the same set (a poll re-reads the same job)', () => {
        expect(shouldRequestMatches(new Set(['0:0', '1:0']), [ref('0:0'), ref('1:0')], false)).toBe(false);
    });

    it('does not ask again when the set only SHRANK', () => {
        expect(shouldRequestMatches(new Set(['0:0', '1:0']), [ref('1:0')], false)).toBe(false);
    });

    it('asks when the set gained a member, even if it also lost one', () => {
        expect(shouldRequestMatches(new Set(['0:0']), [ref('1:0')], false)).toBe(true);
        expect(shouldRequestMatches(new Set(['0:0']), [ref('0:0'), ref('1:0')], false)).toBe(true);
    });

    it('never asks while a request is in flight: the next poll asks for what it missed', () => {
        expect(shouldRequestMatches(new Set(), [ref('0:0')], true)).toBe(false);
    });
});
