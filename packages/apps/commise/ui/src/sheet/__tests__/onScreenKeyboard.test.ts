/**
 * The sheet's keyboard rules (`docs/design/ingredientSpecialization.md` §S8.1): an on-screen keyboard is one that
 * hides at least 150 px of an unzoomed viewport, and the toolbar collapses only while such a keyboard is open AND
 * focus is inside the toolbar.
 */
import { describe, expect, it } from 'vitest';

import { ON_SCREEN_KEYBOARD_MIN_HEIGHT, isOnScreenKeyboard, isToolbarCollapsed } from '../onScreenKeyboard.js';

describe('isOnScreenKeyboard', () => {
    it('opens at 150 px hidden and not at 149', () => {
        expect(ON_SCREEN_KEYBOARD_MIN_HEIGHT).toBe(150);
        expect(isOnScreenKeyboard(149, 1)).toBe(false);
        expect(isOnScreenKeyboard(150, 1)).toBe(true);
        expect(isOnScreenKeyboard(336, 1)).toBe(true);
    });

    it('reads a zoomed viewport as no keyboard, so a pinch-zoom never collapses the sheet', () => {
        expect(isOnScreenKeyboard(400, 1.01)).toBe(false);
        expect(isOnScreenKeyboard(400, 2)).toBe(false);
    });

    it('defaults the scale to 1, for a platform with no zoom to report', () => {
        expect(isOnScreenKeyboard(150)).toBe(true);
    });

    it('reads a shrinking viewport, a missing reading and a small accessory bar as no keyboard', () => {
        expect(isOnScreenKeyboard(0, 1)).toBe(false);
        expect(isOnScreenKeyboard(-40, 1)).toBe(false);
        expect(isOnScreenKeyboard(Number.NaN, 1)).toBe(false);
        expect(isOnScreenKeyboard(55, 1)).toBe(false);
    });
});

describe('isToolbarCollapsed', () => {
    it.each([
        [false, false, false],
        [false, true, false],
        [true, false, false],
        [true, true, true],
    ])('keyboard open %s, focus in the toolbar %s → collapsed %s', (keyboardOpen, focusInToolbar, collapsed) => {
        expect(isToolbarCollapsed(keyboardOpen, focusInToolbar)).toBe(collapsed);
    });
});
