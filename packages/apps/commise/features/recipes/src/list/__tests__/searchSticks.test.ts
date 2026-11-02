/**
 * Designer finding C-2, as corrected (`nativeBoards/designAnswers.md`): on a phone the Recipes title, avatar, segments,
 * chips and count bar scroll away with the list. The SEARCH field keeps sticking (buildSpec §4.3), but only while its
 * own height is under a third of the VISIBLE window (the part above the keyboard when one is open). Past that it
 * scrolls with the rest, so a field that grew at the large text sizes cannot hold a third of the screen for ever.
 * The rule is a pure comparison of two measured heights, so the boundary is pinned exactly.
 */
import { describe, expect, it } from 'vitest';

import { SEARCH_STICKS_BELOW_SHARE, searchSticks } from '../searchSticks.js';

describe('searchSticks (C-2)', () => {
    it('names the designer’s one third', () => {
        expect(SEARCH_STICKS_BELOW_SHARE).toBeCloseTo(1 / 3, 10);
    });

    it.each([
        ['a normal field in a normal window', 48, 800, true],
        ['one px under a third of 900', 299, 900, true],
        ['exactly a third of 900', 300, 900, false],
        ['one px over a third', 301, 900, false],
        ['a field grown by the text size, in a window above a keyboard', 180, 480, false],
        ['the same field in the full window', 180, 844, true],
    ] as const)('%s → %s', (_name, search, visible, expected) => {
        expect(searchSticks(search, visible)).toBe(expected);
    });

    it('never sticks before anything is measured, so nothing is pinned by a guess', () => {
        expect(searchSticks(0, 0)).toBe(false);
        expect(searchSticks(48, 0)).toBe(false);
    });

    it('follows the visible window: the keyboard opening can release a field that stuck', () => {
        expect(searchSticks(160, 800)).toBe(true);
        expect(searchSticks(160, 440)).toBe(false);
    });
});
