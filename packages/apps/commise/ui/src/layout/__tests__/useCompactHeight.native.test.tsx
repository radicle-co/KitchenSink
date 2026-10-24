/**
 * The native compact-height hooks (`docs/design/compactHeightLayout.md` §2): the window's height decides compact, and
 * compact AND an open keyboard decide the frames' collapse. Keyed on the WINDOW, so the keyboard alone never changes
 * the layout.
 *
 * react-native-web's `Dimensions` reads the root element's size on a window resize, so a test resizes that; the keyboard
 * reading is mocked, because jsdom has no keyboard.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCompactHeight } from '../useCompactHeight.native.js';
import { useFrameCollapsed } from '../useFrameCollapsed.native.js';

const state = vi.hoisted(() => ({ keyboardShown: false }));

vi.mock('../useKeyboardShown.native.js', () => ({ useKeyboardShown: () => state.keyboardShown }));

/** Resize the window: react-native-web's `Dimensions` reads the root element's height on a resize event. */
function windowHeight(height: number): void {
    Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

beforeEach(() => {
    state.keyboardShown = false;
});

afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
});

describe('useCompactHeight', () => {
    it('is compact in a window under 480 dp tall, and follows a rotation', () => {
        windowHeight(393);
        const { result } = renderHook(() => useCompactHeight());

        expect(result.current).toBe(true);

        windowHeight(851);

        expect(result.current).toBe(false);
    });
});

describe('useFrameCollapsed', () => {
    it('collapses only when the window is compact AND a keyboard is open', () => {
        windowHeight(393);
        state.keyboardShown = true;

        expect(renderHook(() => useFrameCollapsed()).result.current).toBe(true);
    });

    it('does not collapse upright, keyboard or not', () => {
        windowHeight(851);
        state.keyboardShown = true;

        expect(renderHook(() => useFrameCollapsed()).result.current).toBe(false);
    });

    it('does not collapse sideways while the keyboard is closed', () => {
        windowHeight(393);

        expect(renderHook(() => useFrameCollapsed()).result.current).toBe(false);
    });
});
