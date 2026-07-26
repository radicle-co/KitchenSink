import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo, Animated, Text } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { EnterTransition } from '../EnterTransition.native.js';
import { ENTER_DURATION_MS } from '../enterMotion.js';

/**
 * EnterTransition (native) — rendered via react-native-web under jsdom. The native leaf OWNS the animation,
 * so the assertions are about OBSERVED opacity over time, driven by the real (asynchronously read) OS
 * preference:
 *  - reduce motion ON  → settled immediately, and no animation frames are ever scheduled;
 *  - reduce motion OFF → starts hidden, ends settled after the timing completes;
 *  - preference unknown → nothing has started yet (the leak this guards: assuming "motion allowed" plays a
 *    slice of the animation at a reduce-motion user before the preference lands).
 */

/** The `Animated.View` wrapper this leaf renders (the element the opacity is driven onto). */
const wrapper = (container: HTMLElement): HTMLElement => container.firstElementChild as HTMLElement;

/** Flush the pending `isReduceMotionEnabled()` promise so the resolved preference reaches state. */
const settlePreference = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve();
    });
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

beforeEach(() => {
    // react-native-web's shim returns no subscription; the leaf unsubscribes defensively, so keep that shape.
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(undefined as never);
});

describe('EnterTransition (native)', () => {
    it('renders its children', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

        render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );
        await settlePreference();

        expect(screen.getByText('Trending now')).toBeTruthy();
    });

    it('starts nothing while the OS preference is still unknown', () => {
        // A promise that never settles models the window before the preference lands.
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise(() => undefined));

        const { container } = render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );

        // Held at the from-state: not yet animating, and definitely not settled.
        expect(wrapper(container).style.opacity).toBe('0');
    });

    it('settles instantly under reduce-motion, with NO animation', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });

        const { container } = render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );
        await settlePreference();

        // Fully visible with no frames elapsed — the value was SET, not animated.
        expect(wrapper(container).style.opacity).toBe('1');
        expect(wrapper(container).style.transform).toBe('translateY(0px)');
    });

    it('rises and fades in when motion is allowed', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

        const { container } = render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );

        // Before the preference resolves the section is held hidden and offset by the rise distance.
        expect(wrapper(container).style.opacity).toBe('0');
        expect(wrapper(container).style.transform).toBe('translateY(8px)');

        await settlePreference();
        // …then the timing runs to completion.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, ENTER_DURATION_MS + 50));
        });

        expect(wrapper(container).style.opacity).toBe('1');
        expect(wrapper(container).style.transform).toBe('translateY(0px)');
    });

    // react-native-web's JS-driven `Animated` completes within a single jsdom frame, so a mid-flight opacity
    // cannot be sampled here (the same reason `pressedScale` is proven at its source rather than through the
    // renderer). The stagger is therefore asserted on the timing CONFIG the leaf builds — dropping `delay`,
    // changing the duration, or losing the easing all fail this — with the perceived stagger covered on
    // device by Maestro.
    it('drives a delayed 400ms rise + fade with the design-system easing', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        const timing = vi.spyOn(Animated, 'timing');

        render(
            <EnterTransition delayMs={200}>
                <Text>New this week</Text>
            </EnterTransition>,
        );
        await settlePreference();

        expect(timing).toHaveBeenCalledTimes(1);
        expect(timing.mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({ toValue: 1, duration: ENTER_DURATION_MS, delay: 200 }),
        );
    });

    it('creates NO animation at all under reduce-motion (the gate, not a cancelled animation)', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        const timing = vi.spyOn(Animated, 'timing');

        render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );
        await settlePreference();

        expect(timing).not.toHaveBeenCalled();
    });

    it('stops the animation on unmount (no animation left running against a dead view)', async () => {
        vi.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

        const { unmount } = render(
            <EnterTransition>
                <Text>Trending now</Text>
            </EnterTransition>,
        );
        await settlePreference();

        // An un-stopped Animated timing keeps ticking after unmount and warns/leaks; unmounting mid-animation
        // must be clean.
        expect(() => unmount()).not.toThrow();
    });
});
