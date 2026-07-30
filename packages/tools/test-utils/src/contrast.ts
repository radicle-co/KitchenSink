/**
 * @module @commise/test-utils/contrast — WCAG 2.1 colour-contrast measurement for design-system tests.
 *
 * Contrast is a REQUIREMENT of this codebase (`docs/CODING_STANDARDS.md`, the U4 accessibility pass), and a
 * requirement nobody measures is a requirement nobody has. Several coral-on-coral surfaces shipped at 2.2:1
 * — half the AA floor — precisely because the review question was "does this look readable?" rather than
 * "what is the ratio?". These helpers make the ratio assertable, so a regression fails a test instead of
 * reaching a reader.
 *
 * The luminance/contrast math is `culori`'s (`wcagContrast`), not hand-rolled: the sRGB linearisation
 * threshold, the gamma exponent and the +0.05 offset are all places a re-implementation silently lands a few
 * hundredths off and moves a colour across the 4.5 line. What this module ADDS is the piece a contrast
 * library cannot know — Commise paints most of its chips and glass on TRANSLUCENT surfaces (`bg-coral/10`,
 * `from-white/80`), and a ratio measured against the raw token is a ratio no reader ever experiences. So the
 * composite step is explicit and required: resolve the surface a reader actually sees, then measure it.
 *
 * Every function here is pure.
 */
import { blend, formatHex, wcagContrast } from 'culori';

/**
 * What a colour pair is being used for, which selects the WCAG 2.1 AA floor:
 *
 *  - `normal-text` — body copy below 18.66px bold / 24px regular. 4.5:1 (SC 1.4.3).
 *  - `large-text` — 18.66px bold or 24px regular and above. 3:1 (SC 1.4.3).
 *  - `ui-component` — a control boundary, focus indicator or meaningful graphic. 3:1 (SC 1.4.11).
 */
export type ContrastUse = 'normal-text' | 'large-text' | 'ui-component';

/** The WCAG 2.1 AA minimum ratio for each use. */
const AA_FLOOR: Record<ContrastUse, number> = {
    'normal-text': 4.5,
    'large-text': 3,
    'ui-component': 3,
};

/**
 * Flatten a translucent `overlay` onto an opaque `backdrop` (CSS `source-over`), yielding the opaque colour a
 * reader actually sees. Use this on any `/10`-style Tailwind tint or `rgba(...)` token BEFORE measuring it:
 * `contrastRatio(fg, 'rgba(232,145,122,0.1)')` scores the text against opaque coral, which is not what is on
 * screen.
 *
 * @param overlay - The translucent colour painted on top, in any CSS notation.
 * @param backdrop - The opaque colour beneath it, in any CSS notation.
 * @returns The composited colour as a `#rrggbb` hex string.
 */
export function compositeOver(overlay: string, backdrop: string): string {
    return formatHex(blend([backdrop, overlay], 'normal')) ?? backdrop;
}

/**
 * The WCAG 2.1 contrast ratio between two OPAQUE colours, in the range 1..21. Symmetric: the order of the
 * arguments does not change the result.
 *
 * @param foreground - Any CSS colour notation.
 * @param background - Any CSS colour notation. Composite it first ({@link compositeOver}) if it is translucent.
 * @returns The ratio, e.g. `21` for black on white.
 */
export function contrastRatio(foreground: string, background: string): number {
    return wcagContrast(foreground, background);
}

/**
 * Whether a colour pair clears the WCAG 2.1 **AA** floor for the way it is used.
 *
 * @param foreground - Any CSS colour notation.
 * @param background - Any OPAQUE CSS colour notation (composite translucent surfaces first).
 * @param use - What the pair is for; selects the 4.5:1 or 3:1 floor.
 * @returns `true` when the pair meets or exceeds its floor.
 */
export function meetsContrast(foreground: string, background: string, use: ContrastUse): boolean {
    return contrastRatio(foreground, background) >= AA_FLOOR[use];
}
