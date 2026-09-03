/**
 * @module @commise/ui/button — the web design-system {@link Button}.
 *
 * A labelled action control styled to the Commise mockups: a pill with an icon + text and a real visible
 * surface for every tier (filled primary CTA, bordered secondary, bordered error-toned destructive) — never
 * naked text. Consumes the shared {@link ButtonProps} contract; the native leaf (`Button.native.tsx`)
 * mirrors it. Classes reference `@commise/ui` design tokens exposed as Tailwind utilities by the consuming
 * app's theme.
 *
 * The icon is wrapped `aria-hidden`, so it is always decorative and the visible label (`children`) owns the
 * accessible name — keeping name-based selection (RTL / Playwright / Maestro) stable regardless of glyph.
 *
 * Two behaviours are shared with the native leaf but expressed in the web idiom:
 *  - **Touch target** — a `min-h-11` (44px) floor at base for comfortable touch, RESET at `md:` so the
 *    mouse density (`py-2.5`, ~40px) is unchanged on desktop. (The WCAG-AA bar 2.5.8/24px is already met;
 *    this is a comfort bump for touch, not a desktop change.)
 *  - **Busy** — the `busy` prop swaps the icon slot for a real spinner in place (no layout shift) and
 *    disables the control; and the whole button is wrapped in {@link PressScale} for a motion-safe
 *    press-scale.
 *
 * @pattern Value Object contract (`ButtonProps`) rendered as a pure `props → JSX` leaf, composed with the
 *     `PressScale` Decorator — the tier is a discriminated `variant`, never a boolean that switches behaviour.
 */
import type { FC } from 'react';

import { PressScale } from '../pressScale/index.js';
import type { ButtonProps } from './props.js';
import { buttonSurfaceClass } from './surfaceClass.js';

/**
 * The in-flight spinner. `currentColor` so it inherits the tier's text colour; `animate-spin` for the
 * rotation. It renders in the SAME `aria-hidden` slot the icon uses, so busy state does not reflow the
 * label. The busy state is announced via the button's `aria-busy`, so the glyph itself stays decorative.
 */
const Spinner: FC = () => (
    <svg
        className="animate-spin"
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

/** The Commise design-system button — icon + label, one visible surface per tier. */
export const Button: FC<ButtonProps> = ({
    variant = 'primary',
    icon,
    children,
    onPress,
    type = 'button',
    disabled = false,
    busy = false,
    accessibilityLabel,
}) => (
    <PressScale>
        <button
            type={type}
            onClick={onPress}
            // A busy control is also disabled so an in-flight action cannot be double-fired.
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            aria-label={accessibilityLabel}
            className={buttonSurfaceClass(variant)}
        >
            <span aria-hidden="true" className="inline-flex shrink-0 items-center">
                {busy ? <Spinner /> : icon}
            </span>
            <span>{children}</span>
        </button>
    </PressScale>
);
