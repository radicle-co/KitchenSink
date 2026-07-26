/**
 * @module @commise/ui/press-scale — shared, platform-neutral prop contract for the design-system
 * {@link PressScale} press-feedback primitive.
 *
 * `PressScale` gives a control a tactile "shrink while held" scale, respecting the OS reduce-motion
 * preference. The two leaves reach that behaviour differently — and this asymmetry is intrinsic, not an
 * oversight:
 *  - **native** (`PressScale.native.tsx`) OWNS the interaction: it renders the `Pressable` and animates a
 *    `transform` scale from its `pressed` state, so it consumes {@link PressScaleProps.onPress},
 *    {@link PressScaleProps.disabled}, {@link PressScaleProps.busy} and the `accessibility*` props.
 *  - **web** (`PressScale.tsx`) is PRESENTATIONAL: it wraps its child in a span carrying a
 *    `motion-safe:active:scale-[0.98]` utility. CSS puts an activated element's ANCESTORS into `:active`,
 *    so the wrapped interactive child (e.g. a `<button>`) drives the scale while itself owning press
 *    semantics and accessibility. The interaction/accessibility props are therefore ignored on web —
 *    wire them on the child you wrap.
 *
 * Callers get one import and one mental model ("wrap the thing that should scale on press"); each leaf
 * honours it in the only way its platform allows.
 */
import type { ReactNode } from 'react';

/** The accessibility roles a native `PressScale` may expose on its `Pressable` (native-only). */
export type PressScaleRole = 'button' | 'link' | 'none';

/** The cross-platform contract shared by the web and native `PressScale` leaves. */
export interface PressScaleProps {
    /** The content that scales on press (native) / the interactive child that drives the scale (web). */
    readonly children: ReactNode;
    /**
     * Press handler. Consumed by the NATIVE leaf, which owns the `Pressable`. On WEB the wrapped child owns
     * the press, so this is ignored there — attach your handler to the child.
     */
    readonly onPress?: () => void;
    /** Disables the press feedback (both) and the underlying `Pressable` (native). Defaults to `false`. */
    readonly disabled?: boolean;
    /** Exposes an in-flight state to assistive tech on the native `Pressable`. Native-only. */
    readonly busy?: boolean;
    /** Accessible name for the native `Pressable`. Native-only (the web child owns its own name). */
    readonly accessibilityLabel?: string;
    /** Accessibility role for the native `Pressable`. Defaults to `button`. Native-only. */
    readonly accessibilityRole?: PressScaleRole;
}
