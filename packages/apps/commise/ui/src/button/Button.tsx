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
 */
import type { FC } from 'react';

import type { ButtonProps, ButtonVariant } from './props.js';

const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-body-sm font-semibold ' +
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Per-tier surface. Each tier renders a distinct, visible affordance — the whole point of the primitive is
 * that no button reads as plain text. (This map is the web idiom of the shared {@link ButtonVariant} set;
 * the native leaf carries the equivalent StyleSheet mapping — the two change for different reasons.)
 */
const variantClass: Record<ButtonVariant, string> = {
    primary: 'bg-gradient-to-br from-seafoam to-ocean-dark text-white shadow-sm hover:opacity-95',
    secondary: 'border border-border bg-white text-charcoal shadow-sm hover:bg-pearl',
    destructive: 'border border-error/40 bg-white text-error shadow-sm hover:bg-error/10',
};

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
    <button
        type={type}
        onClick={onPress}
        // A busy control is also disabled so an in-flight action cannot be double-fired.
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-label={accessibilityLabel}
        className={`${base} ${variantClass[variant]}`}
    >
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
            {icon}
        </span>
        <span>{children}</span>
    </button>
);
