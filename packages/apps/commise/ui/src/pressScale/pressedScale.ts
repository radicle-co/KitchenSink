/**
 * @module @commise/ui/press-scale — the pure press-scale computation shared by the native
 * {@link import('./PressScale.native.js').PressScale} leaf.
 *
 * The native leaf drives a `transform: [{ scale }]` from its `Pressable`'s `pressed` state; this module
 * isolates the branch logic so it is unit-testable without a renderer. The web leaf does the same thing
 * declaratively with a Tailwind `motion-safe:active:scale-*` utility, so it has no counterpart here.
 */

/**
 * The design-system press-scale factor — the pill/card/FAB shrinks to 98% while held. One canonical value
 * so the tactile feedback reads the same everywhere (web hard-codes the equivalent `scale-[0.98]` utility).
 */
export const PRESS_SCALE = 0.98;

/** Inputs to {@link pressedScale} — the render-time state that decides whether the scale applies. */
export interface PressedScaleInput {
    /** Whether the control is currently held down. */
    readonly pressed: boolean;
    /** Whether the control is disabled — a disabled control gives no press feedback. */
    readonly disabled: boolean;
    /** Whether the OS "reduce motion" setting is on — non-essential motion is suppressed. */
    readonly reduceMotion: boolean;
    /** The pressed scale factor. Defaults to {@link PRESS_SCALE}. */
    readonly scale?: number;
}

/**
 * Resolve the scale to apply this render: the pressed scale only when the control is actively held, is not
 * disabled, and motion is not reduced; otherwise the neutral `1`. Pure — the same inputs always map to the
 * same output, so the reduce-motion suppression is provable without a DOM.
 */
export function pressedScale({ pressed, disabled, reduceMotion, scale = PRESS_SCALE }: PressedScaleInput): number {
    if (!pressed || disabled || reduceMotion) {
        return 1;
    }

    return scale;
}
