/**
 * The native sheet's keyboard reading: shown only while React Native reports a visible keyboard at least 150 dp
 * tall, so an iPad shortcut bar does not collapse the sheet (§S8.1). Also the ONE subscription that the keyboard's frame
 * is read from.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardFrame } from '../../keyboardAvoider/useKeyboardFrame.native.js';
import { installFakeKeyboard, type FakeKeyboard } from '../../testing/fakeKeyboard.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { useKeyboardShown } from '../useKeyboardShown.native.js';

describe('useKeyboardShown', () => {
    let fake: FakeKeyboard;

    beforeEach(() => {
        fake = installFakeKeyboard();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fake.restore();
    });

    /** Report a keyboard change the way Android does: move the state, then fire the Did event. */
    function keyboard(event: 'keyboardDidShow' | 'keyboardDidHide', height: number): void {
        const frame = event === 'keyboardDidShow' ? { screenY: 844 - height, height } : null;

        fake.settle(frame);
        act(() => fake.emit(event, frame ?? undefined));
    }

    it('reads shown for a full keyboard and hidden again after it closes', () => {
        const { result } = renderHook(() => useKeyboardShown());

        expect(result.current).toBe(false);

        keyboard('keyboardDidShow', 336);
        expect(result.current).toBe(true);

        keyboard('keyboardDidHide', 0);
        expect(result.current).toBe(false);
    });

    it('reads a keyboard that was already up before it mounted', () => {
        fake.settle({ screenY: 508, height: 336 });

        const { result } = renderHook(() => useKeyboardShown());

        expect(result.current).toBe(true);
    });

    it('reads a 55 dp shortcut bar as no keyboard', () => {
        const { result } = renderHook(() => useKeyboardShown());

        keyboard('keyboardDidShow', 55);

        expect(result.current).toBe(false);
    });

    it('removes both listeners when it unmounts', () => {
        renderHook(() => useKeyboardShown()).unmount();

        expect([...fake.added].sort()).toStrictEqual(['keyboardDidHide', 'keyboardDidShow']);
        expect(fake.removed()).toBe(2);
    });

    describe('with the keyboard reported by its own event', () => {
        it('iOS: reads shown on keyboardWillShow, before any Did event, and hidden on keyboardWillHide', () => {
            withPlatformOs('ios', () => {
                const { result } = renderHook(() => useKeyboardShown());

                act(() => fake.emit('keyboardWillShow', { screenY: 544, height: 300 }));
                expect(result.current).toBe(true);

                act(() => fake.emit('keyboardWillHide'));
                expect(result.current).toBe(false);
            });
        });

        it('iOS: reads a 40 dp accessory bar as no keyboard', () => {
            withPlatformOs('ios', () => {
                const { result } = renderHook(() => useKeyboardShown());

                act(() => fake.emit('keyboardWillShow', { screenY: 544, height: 300 }));
                expect(result.current).toBe(true);

                act(() => fake.emit('keyboardWillShow', { screenY: 804, height: 40 }));
                expect(result.current).toBe(false);
            });
        });

        it('iOS: listens for the Will and the Did events and removes all four when it unmounts', () => {
            withPlatformOs('ios', () => {
                renderHook(() => useKeyboardShown()).unmount();

                expect([...fake.added].sort()).toStrictEqual([
                    'keyboardDidHide',
                    'keyboardDidShow',
                    'keyboardWillHide',
                    'keyboardWillShow',
                ]);
                expect(fake.removed()).toBe(4);
            });
        });

        it('iOS: a reader that mounted between Will and Did, and read the old keyboard, is corrected by the Did event', () => {
            withPlatformOs('ios', () => {
                // The Will event fired with nobody listening: React Native's own state still says "no keyboard".
                const { result } = renderHook(() => useKeyboardShown());

                expect(result.current).toBe(false);

                // The keyboard settles: React Native's state has caught up, and the Did event says so.
                fake.settle({ screenY: 544, height: 300 });
                act(() => fake.emit('keyboardDidShow', { screenY: 544, height: 300 }));

                expect(result.current).toBe(true);
            });
        });

        it('Android: follows the Did events and listens for no Will event', () => {
            withPlatformOs('android', () => {
                const { result } = renderHook(() => useKeyboardShown());

                expect(fake.added).not.toContain('keyboardWillShow');

                keyboard('keyboardDidShow', 300);
                expect(result.current).toBe(true);

                keyboard('keyboardDidHide', 0);
                expect(result.current).toBe(false);
            });
        });
    });

    describe('with the frame read beside it', () => {
        it('serves the shown flag and the frame from ONE pair of listeners, and removes them with the last reader', () => {
            const shown = renderHook(() => useKeyboardShown());
            const frame = renderHook(() => useKeyboardFrame());

            expect(fake.added).toHaveLength(2);

            keyboard('keyboardDidShow', 336);
            expect(shown.result.current).toBe(true);
            expect(frame.result.current).toStrictEqual({ top: 508, height: 336 });

            shown.unmount();
            expect(fake.removed()).toBe(0);

            frame.unmount();
            expect(fake.removed()).toBe(2);
        });

        it('hands back the same frame object until the keyboard moves', () => {
            fake.settle({ screenY: 508, height: 336 });
            const { result, rerender } = renderHook(() => useKeyboardFrame());
            const first = result.current;

            rerender();

            expect(result.current).toBe(first);
        });
    });
});
