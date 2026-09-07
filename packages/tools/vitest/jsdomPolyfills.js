/**
 * Browser APIs jsdom does not implement, installed as a vitest `setupFiles` entry.
 *
 * ⛔ POLYFILLS FOR ABSENT APIs, never behaviour changes. Each entry below is a constructor or method that a
 * real browser has and jsdom does not, whose absence makes a component look broken when it is not. Nothing
 * here alters semantics a test could reasonably assert on.
 */

/**
 * ⛔ `AnimationEvent` — REMOVED FROM jsdom 30, and its absence is silent and total.
 *
 * jsdom 24 exposed the constructor; 30 does not register the interface at all (`typeof AnimationEvent` is
 * `"undefined"`). Testing Library's `fireEvent.animationEnd` then falls back to a plain `Event`, React never
 * maps that to `onAnimationEnd`, and any component gated on an animation completing simply never advances.
 *
 * ⚠️ THE FAILURE READS AS A COMPONENT BUG AND IS NOT ONE. `react-native-web`'s `Modal` becomes "active" only
 * via `onAnimationEnd -> onShow -> addActiveModal`, so without this the modal never registers, `active` stays
 * false, `role="dialog"` never appears and its Escape handler is never armed. Two tests failed asserting
 * `onRequestClose`; the component was correct the whole time. Diagnosed by observing that neither the
 * animation event on any layer NOR a direct `keyup` on `document` reached the handler — `active` was the
 * common cause, and a missing constructor was the cause of that.
 */
if (typeof globalThis.AnimationEvent === 'undefined') {
    class AnimationEventPolyfill extends Event {
        constructor(type, init = {}) {
            super(type, init);
            this.animationName = init.animationName ?? '';
            this.elapsedTime = init.elapsedTime ?? 0;
            this.pseudoElement = init.pseudoElement ?? '';
        }
    }

    globalThis.AnimationEvent = AnimationEventPolyfill;
}

/**
 * `TransitionEvent` — absent for the same reason and in the same way. Included because a component gated on
 * a CSS transition rather than an animation fails identically, and finding this a second time would cost
 * what finding it the first time did.
 */
if (typeof globalThis.TransitionEvent === 'undefined') {
    class TransitionEventPolyfill extends Event {
        constructor(type, init = {}) {
            super(type, init);
            this.propertyName = init.propertyName ?? '';
            this.elapsedTime = init.elapsedTime ?? 0;
            this.pseudoElement = init.pseudoElement ?? '';
        }
    }

    globalThis.TransitionEvent = TransitionEventPolyfill;
}
