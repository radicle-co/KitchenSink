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

import { SEARCH_STICKS_BELOW_SHARE, searchPinInterpolation, searchSticks } from '../searchPin.js';

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

describe('searchPinInterpolation (the slide-and-stop)', () => {
    it('slides one for one with the scroll, from where the field naturally sits to the pinned top', () => {
        expect(searchPinInterpolation({ naturalTop: 180, pinnedTop: 8, pins: true })).toEqual({
            inputRange: [0, 172],
            outputRange: [180, 8],
            extrapolateLeft: 'extend',
            extrapolateRight: 'clamp',
        });
    });

    it('follows an overscroll or a pull to refresh (extends on the left) and holds at the top (clamps on the right)', () => {
        const pinned = searchPinInterpolation({ naturalTop: 180, pinnedTop: 8, pins: true });

        expect(pinned.extrapolateLeft).toBe('extend');
        expect(pinned.extrapolateRight).toBe('clamp');
    });

    it('moves exactly with the page, never stopping, when the field is too tall to pin', () => {
        expect(searchPinInterpolation({ naturalTop: 180, pinnedTop: 8, pins: false }).extrapolateRight).toBe('extend');
    });

    it('moves the range when the title above the field grows (font scale), so the pin engages at the right offset', () => {
        const small = searchPinInterpolation({ naturalTop: 180, pinnedTop: 8, pins: true });
        const large = searchPinInterpolation({ naturalTop: 320, pinnedTop: 8, pins: true });

        expect(small.inputRange).toEqual([0, 172]);
        expect(large.inputRange).toEqual([0, 312]);
        expect(large.outputRange).toEqual([320, 8]);
    });

    it('holds still, at a valid range, when the field already sits at or above the pinned top', () => {
        const { inputRange, outputRange } = searchPinInterpolation({ naturalTop: 8, pinnedTop: 8, pins: true });

        expect(inputRange[1]).toBeGreaterThan(inputRange[0] ?? 0);
        expect(new Set(outputRange)).toEqual(new Set([8]));
    });

    it('follows the natural position when the field starts above the pinned top and does not pin', () => {
        const { outputRange } = searchPinInterpolation({ naturalTop: 0, pinnedTop: 8, pins: false });

        expect(outputRange[0]).toBe(0);
    });
});
