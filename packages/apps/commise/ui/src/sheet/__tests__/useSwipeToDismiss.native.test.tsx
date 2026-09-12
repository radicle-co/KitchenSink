/**
 * Swipe the native sheet down to dismiss it (§S8.1). The gesture is claimed only on a downward, mostly vertical move,
 * so a tap on Close is never taken; a release past the threshold dismisses, anything else springs back.
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

    it('claims a downward vertical move, and never a tap, a sideways drag or an upward drag', () => {
        renderHook(() => useSwipeToDismiss(vi.fn(), false));
        const claims = (state: Partial<PanResponderGestureState>) =>
            config.onMoveShouldSetPanResponder?.(event, gesture(state));

        expect(claims({ dy: 12, dx: 2 })).toBe(true);
        expect(claims({ dy: 0, dx: 0 })).toBe(false);
        expect(claims({ dy: 12, dx: 30 })).toBe(false);
        expect(claims({ dy: -40, dx: 0 })).toBe(false);
    });

    it('follows a downward drag and never moves the sheet up', () => {
        const { result } = renderHook(() => useSwipeToDismiss(vi.fn(), false));
        const setValue = vi.spyOn(result.current.translateY, 'setValue');

        config.onPanResponderMove?.(event, gesture({ dy: 40 }));
        config.onPanResponderMove?.(event, gesture({ dy: -20 }));

        expect(setValue.mock.calls).toStrictEqual([[40], [0]]);
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
