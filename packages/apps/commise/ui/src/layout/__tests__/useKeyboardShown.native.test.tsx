/**
 * The native sheet's keyboard reading: shown only while React Native reports a visible keyboard at least 150 dp
 * tall, so an iPad shortcut bar does not collapse the sheet (§S8.1).
 */
import { act, renderHook } from '@testing-library/react';
import { Keyboard } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShown } from '../useKeyboardShown.native.js';

type Listener = () => void;

describe('useKeyboardShown', () => {
    const listeners = new Map<string, Listener>();
    const remove = vi.fn();
    let visible = false;
    let height = 0;

    beforeEach(() => {
        listeners.clear();
        remove.mockClear();
        visible = false;
        height = 0;
        vi.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, listener: Listener) => {
            listeners.set(event, listener);

            return { remove };
        }) as unknown as typeof Keyboard.addListener);
        vi.spyOn(Keyboard, 'isVisible').mockImplementation(() => visible);
        // react-native-web's `Keyboard` has no `metrics`; the device API does.
        Object.defineProperty(Keyboard, 'metrics', {
            value: () => (visible ? { height, width: 390, screenX: 0, screenY: 844 - height } : undefined),
            configurable: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(Keyboard, 'metrics');
    });

    /** Report a keyboard change the way the platform does: move the state, then fire the event. */
    function keyboard(event: 'keyboardDidShow' | 'keyboardDidHide', nextHeight: number): void {
        visible = event === 'keyboardDidShow';
        height = nextHeight;
        act(() => listeners.get(event)?.());
    }

    it('reads shown for a full keyboard and hidden again after it closes', () => {
        const { result } = renderHook(() => useKeyboardShown());

        expect(result.current).toBe(false);

        keyboard('keyboardDidShow', 336);
        expect(result.current).toBe(true);

        keyboard('keyboardDidHide', 0);
        expect(result.current).toBe(false);
    });

    it('reads a 55 dp shortcut bar as no keyboard', () => {
        const { result } = renderHook(() => useKeyboardShown());

        keyboard('keyboardDidShow', 55);

        expect(result.current).toBe(false);
    });

    it('removes both listeners when it unmounts', () => {
        renderHook(() => useKeyboardShown()).unmount();

        expect([...listeners.keys()].sort()).toStrictEqual(['keyboardDidHide', 'keyboardDidShow']);
        expect(remove).toHaveBeenCalledTimes(2);
    });
});
