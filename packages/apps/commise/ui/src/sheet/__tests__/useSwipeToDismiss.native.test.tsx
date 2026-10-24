/**
 * Swipe the native sheet down to dismiss it (§S8.1). The swipe area takes the touch when it starts, so a React Native
 * `Modal` cannot (REWRITTEN: it used to be claimed on a move, which never happens in a Modal; see the hook's doc). Close
 * still takes a tap, because a control inside the area is asked first. The sheet follows only a downward, mostly
 * vertical drag; a release past the threshold dismisses, anything else springs back.
 *
 * `PanResponder.create` is captured rather than driven with synthetic touches: react-native-web builds the gesture
 * state from its touch history, which jsdom does not produce. The on-device proof is the Maestro swipe.
 */
import { act, renderHook } from '@testing-library/react';
import {
    Animated,
    PanResponder,
    type GestureResponderEvent,
    type PanResponderCallbacks,
    type PanResponderGestureState,
} from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSwipeToDismiss } from '../useSwipeToDismiss.native.js';

/** A gesture state with every field zero except those given. */
function gesture(partial: Partial<PanResponderGestureState>): PanResponderGestureState {
    return {
        stateID: 1,
        moveX: 0,
        moveY: 0,
        x0: 0,
        y0: 0,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        numberActiveTouches: 1,
        _accountsForMovesUpTo: 0,
        ...partial,
    };
}

// The handlers read only the gesture state, never the event.
const event = {} as GestureResponderEvent;

describe('useSwipeToDismiss', () => {
    let config: PanResponderCallbacks = {};
    const create = vi.fn();

    beforeEach(() => {
        config = {};
        create.mockReset();
        vi.spyOn(PanResponder, 'create').mockImplementation((callbacks) => {
            config = callbacks;
            create();

            return { panHandlers: {} };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('⛔ takes the touch when it starts: a Modal takes any start nothing inside it took, then asks nothing inside it', () => {
        renderHook(() => useSwipeToDismiss(vi.fn(), false));

        expect(config.onStartShouldSetPanResponder?.(event, gesture({}))).toBe(true);
    });

    // The swipe area claims in the BUBBLE phase only: a capture claim is asked before anything inside it, so it would take
    // Close's tap from Close, and a move claim inside a Modal is never asked (this module's doc).
    it('⛔ never claims a touch in the capture phase, so Close inside it still takes its own tap', () => {
        renderHook(() => useSwipeToDismiss(vi.fn(), false));

        expect(config.onStartShouldSetPanResponderCapture).toBeUndefined();
        expect(config.onMoveShouldSetPanResponderCapture).toBeUndefined();
        expect(config.onMoveShouldSetPanResponder).toBeUndefined();
    });

    it('follows a downward, mostly vertical drag, and never a sideways or an upward one', () => {
        const { result } = renderHook(() => useSwipeToDismiss(vi.fn(), false));
        const setValue = vi.spyOn(result.current.translateY, 'setValue');

        config.onPanResponderMove?.(event, gesture({ dy: 40, dx: 2 }));
        config.onPanResponderMove?.(event, gesture({ dy: 12, dx: 30 }));
        config.onPanResponderMove?.(event, gesture({ dy: -20 }));

        expect(setValue.mock.calls).toStrictEqual([[40], [0], [0]]);
    });

    it('never dismisses a sideways drag, however far down it ends', () => {
        const onDismiss = vi.fn();

        renderHook(() => useSwipeToDismiss(onDismiss, true));

        act(() => config.onPanResponderRelease?.(event, gesture({ dy: 120, dx: 200, vy: 1 })));
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses on a release past the threshold, and springs back short of it', () => {
        const onDismiss = vi.fn();
        const spring = vi.spyOn(Animated, 'spring');

        renderHook(() => useSwipeToDismiss(onDismiss, false));

        act(() => config.onPanResponderRelease?.(event, gesture({ dy: 40, vy: 0.2 })));
        expect(onDismiss).not.toHaveBeenCalled();
        expect(spring).toHaveBeenCalledTimes(1);
        // Back to rest with NO overshoot (§S8.1): the default spring lifts the sheet's edge off the screen.
        expect(spring.mock.calls[0]?.[1]).toMatchObject({ toValue: 0, overshootClamping: true });

        act(() => config.onPanResponderRelease?.(event, gesture({ dy: 120, vy: 0 })));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('snaps back without animating when reduce motion is on or not yet known', () => {
        const spring = vi.spyOn(Animated, 'spring');

        for (const reduceMotion of [true, undefined]) {
            const { result, unmount } = renderHook(() => useSwipeToDismiss(vi.fn(), reduceMotion));
            const setValue = vi.spyOn(result.current.translateY, 'setValue');

            act(() => config.onPanResponderRelease?.(event, gesture({ dy: 40, vy: 0 })));
            act(() => config.onPanResponderTerminate?.(event, gesture({ dy: 40, vy: 0 })));

            expect(setValue.mock.calls).toStrictEqual([[0], [0]]);
            unmount();
        }

        expect(spring).not.toHaveBeenCalled();
    });

    it('creates the responder once, and dismisses through the CURRENT callback, not the one from mount', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(({ onDismiss }) => useSwipeToDismiss(onDismiss, false), {
            initialProps: { onDismiss: first },
        });

        act(() => rerender({ onDismiss: second }));
        act(() => config.onPanResponderRelease?.(event, gesture({ dy: 120 })));

        expect(create).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
