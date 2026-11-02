/**
 * Designer finding C-2, as corrected (`nativeBoards/designAnswers.md`, commit 3869556b3): on a phone the Recipes title,
 * avatar, segments, chips and count bar scroll away with the list. The SEARCH field keeps sticking (buildSpec §4.3) and
 * stops at the top: ONE field, slid with the scroll on the native side until it reaches the top, then held. It pins only
 * while its own height is under a third of the WINDOW (not the part above the keyboard, so the keyboard cannot un-pin it
 * mid-word); past that it scrolls away with the rest.
 *
 * Both parts are pure functions of measured numbers, so the boundaries are pinned exactly.
 */
import { describe, expect, it } from 'vitest';

import { SEARCH_STICKS_BELOW_SHARE, UNPINNED_FLOOR, searchPinGeometry, searchSticks } from '../searchPin.js';

describe('searchSticks (C-2, the window rule)', () => {
    it('names the designer’s one third', () => {
        expect(SEARCH_STICKS_BELOW_SHARE).toBeCloseTo(1 / 3, 10);
    });

    it.each([
        ['a normal field in a normal window', 48, 800, true],
        ['one px under a third of 900', 299, 900, true],
        ['exactly a third of 900', 300, 900, false],
        ['one px over a third', 301, 900, false],
        ['a field grown by the text size in a short (landscape) window', 140, 390, false],
        ['the same field in a tall window', 140, 844, true],
    ] as const)('%s → %s', (_name, search, window, expected) => {
        expect(searchSticks(search, window)).toBe(expected);
    });

    it('never pins before anything is measured, so nothing is pinned by a guess', () => {
        expect(searchSticks(0, 0)).toBe(false);
        expect(searchSticks(48, 0)).toBe(false);
    });
});

describe('searchPinGeometry (what the slide is built from)', () => {
    it('is the measured natural top and the pinned top when the field pins', () => {
        expect(searchPinGeometry({ naturalTop: 180, pinnedTop: 8, pins: true })).toEqual({
            naturalTop: 180,
            pinnedTop: 8,
        });
    });

    it('puts the pinned top out of reach when the field is too tall to pin, so it leaves with the page', () => {
        expect(searchPinGeometry({ naturalTop: 180, pinnedTop: 8, pins: false })).toEqual({
            naturalTop: 180,
            pinnedTop: UNPINNED_FLOOR,
        });
    });
});
