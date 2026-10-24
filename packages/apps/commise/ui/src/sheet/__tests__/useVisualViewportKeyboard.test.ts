/**
 * The web sheet's keyboard reading: the visual viewport's BOX (its height and its top) while an on-screen keyboard
 * hides at least 150 px of an unzoomed window, else `null` (§S8.1).
 *
 * ⚠️ E2 I5 widened the reading from a bare height to `{ height, top }`. The sheet centred inside the visible HEIGHT
 * but on the whole window, so a keyboard hid 100 to 199 px of it; the top (`visualViewport.offsetTop`) is what lets
 * the sheet sit inside the visible box, and it follows an iOS pan, which arrives as a viewport `scroll`, not `resize`.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVisualViewportKeyboard } from '../useVisualViewportKeyboard.js';

/** A stand-in `visualViewport`: an event target with a height, a scale and a top. */
function stubViewport(
    height: number,
    scale = 1,
    offsetTop = 0,
): EventTarget & { height: number; scale: number; offsetTop: number } {
    const viewport = Object.assign(new EventTarget(), { height, scale, offsetTop });

    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });

    return viewport;
}

describe('useVisualViewportKeyboard', () => {
    const innerHeight = window.innerHeight;

    afterEach(() => {
        Reflect.deleteProperty(window, 'visualViewport');
        Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
        vi.restoreAllMocks();
    });

    it('reads null where the browser has no visual viewport', () => {
        Reflect.deleteProperty(window, 'visualViewport');

        expect(renderHook(() => useVisualViewportKeyboard()).result.current).toBeNull();
    });

    it('reads null with no keyboard, then the visible box once a keyboard opens', () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        const viewport = stubViewport(800);
        const { result } = renderHook(() => useVisualViewportKeyboard());

        expect(result.current).toBeNull();

        act(() => {
            viewport.height = 464;
            viewport.dispatchEvent(new Event('resize'));
        });

        expect(result.current).toStrictEqual({ height: 464, top: 0 });

        act(() => {
            viewport.height = 800;
            viewport.dispatchEvent(new Event('resize'));
        });

        expect(result.current).toBeNull();
    });

    it('reads the visible box’s top from the viewport’s offset while a keyboard is open', () => {
        Object.defineProperty(window, 'innerHeight', { value: 1024, configurable: true });
        stubViewport(610, 1, 157);

        expect(renderHook(() => useVisualViewportKeyboard()).result.current).toStrictEqual({ height: 610, top: 157 });
    });

    it('follows an iOS pan, which moves the top through a viewport scroll and not a resize', () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        const viewport = stubViewport(464);
        const { result } = renderHook(() => useVisualViewportKeyboard());

        act(() => {
            viewport.offsetTop = 120;
            viewport.dispatchEvent(new Event('scroll'));
        });

        expect(result.current).toStrictEqual({ height: 464, top: 120 });
    });

    it('reads a pinch-zoom as no keyboard', () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        stubViewport(400, 2);

        expect(renderHook(() => useVisualViewportKeyboard()).result.current).toBeNull();
    });

    it('stops listening when it unmounts', () => {
        const viewport = stubViewport(800);
        const removeFromViewport = vi.spyOn(viewport, 'removeEventListener');
        const removeFromWindow = vi.spyOn(window, 'removeEventListener');

        renderHook(() => useVisualViewportKeyboard()).unmount();

        expect(removeFromViewport).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(removeFromViewport).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeFromWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});
