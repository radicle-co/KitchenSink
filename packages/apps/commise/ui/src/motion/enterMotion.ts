/**
 * @module @commise/ui/motion — the pure enter-motion decision shared by the native
 * {@link import('./EnterTransition.native.js').EnterTransition} leaf.
 *
 * The native leaf must decide, on every render, whether to animate a section in, snap it in with no motion
 * at all, or wait — because React Native can only read the OS reduce-motion preference ASYNCHRONOUSLY.
 * Getting that three-way branch wrong is how reduce-motion gates leak: default the unknown state to "motion
 * allowed" and a reduce-motion user sees the first half of the animation before the preference lands. This
 * module isolates the branch so it is provable without a renderer.
 *
 * The web leaf needs no counterpart: CSS answers the same question declaratively and synchronously via the
 * `motion-safe:` variant, so there is nothing to decide in JS there (mirroring `pressedScale.ts`).
 */

/**
 * Enter-motion duration in milliseconds. Matches the web `--animate-section-enter` keyframe so the two
 * platforms' enter reads at the same pace.
 */
export const ENTER_DURATION_MS = 400;

/** Distance in px a section rises as it enters (the web keyframe's `translateY(0.5rem)`). */
export const ENTER_RISE_PX = 8;

/**
 * What the enter transition should do this render.
 *
 * - `pending` — the OS preference has not resolved yet: hold the from-state and start nothing.
 * - `animate` — motion is allowed: run the rise + fade.
 * - `instant` — reduce motion is ON: jump straight to the settled state, with NO animation.
 */
export type EnterMotionMode = 'pending' | 'animate' | 'instant';

/** Inputs to {@link enterMotionMode}. */
export interface EnterMotionInput {
    /**
     * The OS "reduce motion" preference, or `undefined` while it is still being read (React Native resolves
     * it asynchronously).
     */
    readonly reduceMotion: boolean | undefined;
}

/**
 * Resolve the enter-motion mode for this render. Pure — the same input always maps to the same mode, so the
 * reduce-motion suppression (and the deliberate refusal to guess before the preference is known) is
 * provable without a DOM.
 */
export function enterMotionMode({ reduceMotion }: EnterMotionInput): EnterMotionMode {
    if (reduceMotion === undefined) {
        return 'pending';
    }

    return reduceMotion ? 'instant' : 'animate';
}
