/**
 * Unit tests for the food-search minimum-length policy (003-FR-010a, plan U37).
 *
 * ⛔ THE NUMBER IS THE TEST. FR-010a's floor was chosen from a measurement against the real 8,094-row
 * catalog — one character matches 51% of it, two characters 23%, against a surface that shows ten to twenty
 * rows — and from an enumeration of the catalog's genuine three-character foods. So the cases below pin BOTH
 * directions of the boundary: `eg` must be refused and `egg` must be admitted. A four-character floor would
 * pass a "short queries are refused" test and silently break fifteen real foods, which is exactly why the
 * three-character cases are named individually rather than folded into a length loop.
 *
 * Mutation lens: every case fails if the constant moves in either direction, if the predicate stops trimming
 * (a trailing space would buy a caller a free character), or if it reverts to counting UTF-16 code units
 * (a single astral character would read as a 2-character query).
 */
import { describe, expect, it } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '../searchMinimum.js';

describe('MIN_SEARCH_QUERY_LENGTH', () => {
    it('is three — the floor FR-010a measured, not four', () => {
        expect(MIN_SEARCH_QUERY_LENGTH).toBe(3);
    });
});

describe('meetsSearchMinimum', () => {
    describe('below the floor — a query that cannot discriminate', () => {
        it.each(['', 'e', 'eg'])('refuses %j', (query) => {
            expect(meetsSearchMinimum(query)).toBe(false);
        });

        it('refuses whitespace-only input of any length, because trimming is what counts', () => {
            expect(meetsSearchMinimum('     ')).toBe(false);
        });

        it('does not let surrounding whitespace buy a caller a character', () => {
            expect(meetsSearchMinimum(' eg ')).toBe(false);
        });

        it('counts CHARACTERS, not UTF-16 code units — two astral characters are still two', () => {
            // '🍳🍳' is 4 code units and 2 characters. Counting code units would admit it.
            expect(meetsSearchMinimum('🍳🍳')).toBe(false);
        });
    });

    describe('at and above the floor — the genuine three-character foods FR-010a enumerates', () => {
        it.each([
            'egg',
            'ham',
            'rye',
            'cod',
            'soy',
            'oat',
            'fig',
            'yam',
            'nut',
            'tea',
            'pie',
            'elk',
            'gin',
            'rum',
            'poi',
        ])('admits %j', (query) => {
            expect(meetsSearchMinimum(query)).toBe(true);
        });

        it('admits a three-character query padded with whitespace', () => {
            expect(meetsSearchMinimum('  egg  ')).toBe(true);
        });

        it('admits a longer query', () => {
            expect(meetsSearchMinimum('chicken breast')).toBe(true);
        });

        it('admits three astral characters', () => {
            expect(meetsSearchMinimum('🍳🍳🍳')).toBe(true);
        });
    });
});
