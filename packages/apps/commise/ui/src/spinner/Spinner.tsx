/**
 * @module @commise/ui/spinner — the web in-flight spinner. INTERNAL to the design system (no package export): `Button`
 * draws it in its busy glyph slot and `LoadingNotice` draws it beside its caption.
 *
 * `currentColor` so it inherits its context's text colour. It is decorative (`aria-hidden`): whoever draws it carries
 * the meaning — `Button` through `aria-busy`, `LoadingNotice` through its caption.
 *
 * ⛔ The spin class is the CALLER's, not the spinner's. `Button` spins unconditionally (inside a control the spin is
 * the only busy cue); `LoadingNotice` spins `motion-safe:` only (its caption carries the meaning, so a still arc is
 * enough under reduced motion).
 *
 * Presentational: props → JSX.
 *
 * @pattern Strategy — the caller picks the spin class (always, or `motion-safe:` only); the arc is the same
 */
import type { FC } from 'react';

/** Props for {@link Spinner}. */
export interface SpinnerProps {
    /** Utility classes for the `svg`: the spin animation, and any text colour. */
    readonly className: string;
}

/** The 20 px spinning arc. */
export const Spinner: FC<SpinnerProps> = ({ className }) => (
    <svg
        className={className}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);
