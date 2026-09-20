/**
 * @module @commise/ui/testing/hardware-back — a faithful stand-in for React Native's `BackHandler`, for suites
 * that need to raise a real hardware-back press.
 *
 * ⛔ WHY THIS HAS TO EXIST. Every native suite in this repo runs `react-native` aliased to `react-native-web`,
 * whose `BackHandler.addEventListener` is an inert stub: it logs `console.error` and hands back a no-op
 * subscription. So nothing registered through it can ever be invoked, and no test could observe back
 * behaviour at all — which is exactly how a hardware-back press came to destroy an unsaved recipe draft with
 * no test anywhere able to see it.
 *
 * It models the two RN semantics the back seam turns on, and no others:
 *   1. subscriptions are invoked **last-registered-first**;
 *   2. the **first `true` consumes** the event, and the rest are never asked.
 *
 * Modelling the ORDER is the point. A back seam that works only because exactly one handler happens to be
 * registered is correct by accident; `press()` is what makes "the pushed surface is asked before its host"
 * an assertion rather than a hope.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT MODEL: an open RN `Modal`. On a device the modal host catches
 * `KEYCODE_BACK` on the dialog window and fires `onRequestClose` itself, so no JS `hardwareBackPress` event is
 * emitted at all while one is up. There is no DOM equivalent under `react-native-web`, so that layering
 * belongs to Maestro. A suite must not assert dialog-dismiss-on-back through this helper.
 *
 * ⚠️ It replaces the method directly rather than through `vi.spyOn`, so this package stays free of a test
 * framework import. `restore()` is therefore the caller's job — `vi.restoreAllMocks()` will not undo it.
 *
 * ⚠️ It lives HERE, beside the `BackHandler` adapter it fakes, rather than in `@commise/test-utils`, because
 * that package depends on `@commise/ui` — so the design system cannot import it back without a cycle, and the
 * one suite that most needs this fake is `@commise/ui`'s own. `@commise/features-account/testing` is the house
 * precedent for a test-only package subpath.
 */
import { act } from '@testing-library/react';
import { BackHandler } from 'react-native';

/** A hardware-back subscriber, in React Native's own signature. */
export type HardwareBackSubscriber = () => boolean;

/** The control surface {@link installHardwareBackHandler} hands back. */
export interface HardwareBackHandle {
    /**
     * Raise one hardware-back press.
     *
     * The dispatch runs inside `act`, because a real subscriber answers by navigating or opening a dialog and
     * React 19 does not flush a state update raised outside one. Wrapping it HERE rather than at each call site
     * is deliberate: an unwrapped press leaves every assertion reading the PREVIOUS render, so a suite fails on
     * cases that already work and the failure points nowhere near the cause.
     *
     * @returns `true` once a subscriber consumed it; `false` when every one declined (on a device, the point
     *   at which React Native applies its own default and leaves the app).
     */
    readonly press: () => boolean;
    /** How many subscriptions are registered right now — the guard against a listener that re-registers. */
    readonly subscriberCount: () => number;
    /** How many subscriptions have been made since install, including ones since removed. */
    readonly subscribeCount: () => number;
    /** Put the real (stub) `BackHandler.addEventListener` back. Call it from `afterEach`. */
    readonly restore: () => void;
}

/**
 * Replace `BackHandler.addEventListener` with a recording, dispatchable fake.
 *
 * @returns Its {@link HardwareBackHandle}.
 * @sideEffect Mutates the shared `BackHandler` module object until `restore()` is called.
 */
export function installHardwareBackHandler(): HardwareBackHandle {
    const subscribers: HardwareBackSubscriber[] = [];
    const original = BackHandler.addEventListener;
    let subscribeCount = 0;

    const fake = (_event: string, subscriber: HardwareBackSubscriber): { remove: () => void } => {
        subscribers.push(subscriber);
        subscribeCount += 1;

        return {
            remove: () => {
                const index = subscribers.indexOf(subscriber);

                if (index >= 0) {
                    subscribers.splice(index, 1);
                }
            },
        };
    };

    (BackHandler as { addEventListener: unknown }).addEventListener = fake;

    return {
        press: () => {
            let consumed = false;

            act(() => {
                // Iterated over a snapshot for the same reason the production registry is: a subscriber may
                // remove itself or a sibling while answering.
                for (const subscriber of [...subscribers].reverse()) {
                    if (subscriber() === true) {
                        consumed = true;

                        return;
                    }
                }
            });

            return consumed;
        },
        subscriberCount: () => subscribers.length,
        subscribeCount: () => subscribeCount,
        restore: () => {
            (BackHandler as { addEventListener: unknown }).addEventListener = original;
            subscribers.length = 0;
        },
    };
}
