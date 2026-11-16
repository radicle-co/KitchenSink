/**
 * The native report that the keyboard closed, which ends Change food on a row when nothing new was typed
 * (`docs/design/rowEditorOpenDecisions.md` item 4, the native column of "Focus leaves the row").
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeKeyboard, type FakeKeyboard } from '../../testing/fakeKeyboard.native.js';
import { useKeyboardHidden } from '../useKeyboardHidden.native.js';

describe('useKeyboardHidden', () => {
    let fake: FakeKeyboard;

    beforeEach(() => {
        fake = installFakeKeyboard();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fake.restore();
    });

    it('reports the keyboard closing, and not the keyboard opening', () => {
        const onHidden = vi.fn();
        renderHook(() => {
            useKeyboardHidden(onHidden);
        });

        act(() => fake.emit('keyboardDidShow', { screenY: 500, height: 300 }));
        expect(onHidden).not.toHaveBeenCalled();

        act(() => fake.emit('keyboardDidHide'));
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
        act(() => fake.emit('keyboardDidHide'));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(fake.added).toHaveLength(1);
    });

    it('stops listening when it unmounts', () => {
        const { unmount } = renderHook(() => {
            useKeyboardHidden(vi.fn());
        });

        unmount();

        expect(fake.removed()).toBe(1);
    });
});
