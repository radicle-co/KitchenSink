/**
 * @module @commise/features-recipes/actions — the recipe-action glyphs (web).
 *
 * Hand-inlined stroked line icons, mirroring the `form/` and `wizard/` slices' convention (and the native
 * leaf's `Feather` names one-to-one) rather than adding an icon dependency for a fixed, tiny set.
 *
 * Each glyph is **decorative**: the design-system `Button` wraps whatever it is handed in an `aria-hidden`
 * slot, and the glyph carries `aria-hidden` itself as well, so it never contributes to the control's
 * accessible name — the visible label owns that, which is what keeps name-based selection (RTL, Playwright,
 * Maestro) stable.
 */
import type { FC } from 'react';

/**
 * Copy — the CLONE affordance's glyph, everywhere it appears.
 *
 * It lives here, shared, for the same reason the clone controls share one DS tier: "what a clone action looks
 * like" is ONE decision. The product has three clone affordances (the recipe-detail footer, the
 * collection-actions rail, and each public-discovery result card) and they previously disagreed on colour,
 * shape and glyph. Re-typing the paths per call site is exactly how they drift apart again.
 */
export const CloneIcon: FC = () => (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth="2" />
        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
);
