/**
 * @module @commise/ui/motion — the pure enter-motion decision shared by the native
 * `EnterTransition` (`./EnterTransition.native.tsx`) leaf.
 *
 * The native leaf must decide, on every render, whether to animate a section in, snap it in with no motion
 * at all, or wait — because React Native can only read the OS reduce-motion preference ASYNCHRONOUSLY.
 * Getting that three-way branch wrong is how reduce-motion gates leak: default the unknown state to "motion
 * allowed" and a reduce-motion user sees the first half of the animation before the preference lands. This
 * module isolates the branch so it is provable without a renderer.
 *
 * The web leaf needs no counterpart DECISION: CSS answers the same question declaratively and synchronously
 * via the `motion-safe:` variant, so there is nothing to decide in JS there (mirroring `pressedScale.ts`).
 * What does live here is the NAME of that gated utility — a value, not a decision — so that the barrel can
 * export it to consumers that apply the enter gesture to an element of their own instead of wrapping one in
 * `EnterTransition`. It has to sit in this module rather than beside the web leaf, because the leaf specifier
 * resolves to `EnterTransition.native.tsx` on React Native, where no such export exists.
 */

/**
 * The design-system section-enter utility: a short rise + fade, applied ONLY when motion is safe. Registered
 * as the `--animate-section-enter` theme token, so a reduce-motion viewer gets the settled element directly,
 * with no animation and therefore no hidden from-state.
 *
 * ⚠️ A pure-CSS mount animation fires when the element CARRYING it is inserted. Put this on the element that
 * actually appears; on a wrapper that is always rendered, the keyframe runs once at mount over whatever is
 * (not) inside it and is finished before the content the author meant to animate ever exists.
 */
export const enterTransitionClassName = 'motion-safe:animate-section-enter';

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
