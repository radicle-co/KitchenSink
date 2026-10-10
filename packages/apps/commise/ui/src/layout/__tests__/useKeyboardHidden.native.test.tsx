/**
 * The native report that the keyboard closed, which ends Change food on a row when nothing new was typed
 * (`docs/design/rowEditorOpenDecisions.md` item 4, the native column of "Focus leaves the row").
 */
import { act, renderHook } from '@testing-library/react';
import { Keyboard } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardHidden } from '../useKeyboardHidden.native.js';

type Listener = () => void;

describe('useKeyboardHidden', () => {
    const listeners = new Map<string, Listener>();
    const remove = vi.fn();
    const addListener = vi.fn();

    beforeEach(() => {
        listeners.clear();
        remove.mockClear();
        addListener.mockClear();
        vi.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, listener: Listener) => {
            addListener(event);
            listeners.set(event, listener);

            return { remove };
        }) as unknown as typeof Keyboard.addListener);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function keyboard(event: 'keyboardDidShow' | 'keyboardDidHide'): void {
        act(() => listeners.get(event)?.());
    }

    it('reports the keyboard closing, and not the keyboard opening', () => {
        const onHidden = vi.fn();
        renderHook(() => {
            useKeyboardHidden(onHidden);
        });

        keyboard('keyboardDidShow');
        expect(onHidden).not.toHaveBeenCalled();

        keyboard('keyboardDidHide');
        expect(onHidden).toHaveBeenCalledTimes(1);
    });

    it('calls the newest callback without subscribing again', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            ({ onHidden }: { onHidden: () => void }) => {
                useKeyboardHidden(onHidden);
            },
            { initialProps: { onHidden: first } },
        );

        rerender({ onHidden: second });
        keyboard('keyboardDidHide');

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(addListener).toHaveBeenCalledTimes(1);
    });

    it('stops listening when it unmounts', () => {
        const { unmount } = renderHook(() => {
            useKeyboardHidden(vi.fn());
        });

        unmount();

        expect(remove).toHaveBeenCalledTimes(1);
    });
});
