/**
 * @module @commise/ui/button — shared, platform-neutral prop + variant contract for the design-system
 * `Button`. The web (`Button.tsx`) and native (`Button.native.tsx`) leaves both implement this exact
 * surface; the bundler resolves the right leaf per platform at import time (`@commise/ui/button`).
 *
 * The Button is the app-wide standard for a labelled action control, and it encodes two invariants at the
 * type level so callers cannot regress them:
 *  1. **Every button carries an icon.** `icon` is REQUIRED — the mockups pair a glyph with every button
 *     label, so the primitive makes a text-only button unrepresentable.
 *  2. **The label owns the accessible name.** `children` is the visible text AND the accessible name; the
 *     icon is always rendered decoratively (hidden from the accessibility tree by the primitive), so a
 *     screen reader announces the label alone and name-based selection (RTL, Playwright, Maestro) is stable.
 */
import type { ReactNode } from 'react';

/**
 * The visual tiers. `primary` is a filled call-to-action; `secondary` is a bordered "surface" button
 * (reads as a button without competing with the primary); `destructive` is a bordered error-toned action.
 * All three render a real surface — none is naked text.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

/** The cross-platform Button contract shared by the web and native leaves. */
export interface ButtonProps {
    /** Visual tier. Defaults to `primary`. */
    readonly variant?: ButtonVariant;
    /**
     * REQUIRED decorative icon, supplied by the caller in the platform's idiom (an inline `<svg>` on web,
     * a vector-icon element on native). The primitive hides it from the accessibility tree, so it never
     * contributes to the button's accessible name.
     */
    readonly icon: ReactNode;
    /** The visible label. Also the accessible name unless {@link accessibilityLabel} overrides it. */
    readonly children: ReactNode;
    /** Tap / click handler. */
    readonly onPress?: () => void;
    /**
     * Web form semantics — `submit` makes the control submit its enclosing `<form>`. Ignored on native
     * (there is no form element); native submit buttons wire {@link onPress} instead. Defaults to `button`.
     */
    readonly type?: 'button' | 'submit';
    /** Disables interaction and dims the control. */
    readonly disabled?: boolean;
    /**
     * Marks an in-flight action: the control is disabled (so it cannot be double-fired) and exposes a busy
     * state to assistive tech (`aria-busy` on web, `accessibilityState.busy` on native).
     */
    readonly busy?: boolean;
    /**
     * Overrides the label-derived accessible name. Use only when the visible label is not a plain string
     * or is insufficient on its own; prefer letting {@link children} own the name.
     */
    readonly accessibilityLabel?: string;
}
