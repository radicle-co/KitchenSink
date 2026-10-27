/**
 * @module @commise/ui/focus-ring — the ONE focus-ring recipe (`componentFixes.md` §10, §10a). It is the only module that
 * may write a focus-ring token (`focusRingRecipe.test.ts` refuses one anywhere else in the apps).
 *
 * A ring opened 2 px off its control leaves a gap, and the gap must be the colour of what the control sits on: Tailwind
 * paints it `--tw-ring-offset-color`, which defaults to WHITE (a halo in dark) and does not inherit. The recipe sets it
 * to the surface's own fill, read from `--cm-surface` (`surfaceToneClass.ts`), falling back to the canvas outside every
 * surface. A control states no colour of its own, so there is nothing per site to get wrong.
 *
 * Literal classes, for the reason `surfaceToneClass.ts` gives; `focusRingClass.test.ts` holds them to the table.
 *
 *  - `offset`: the default, a 2 px ring 2 px off, its gap the surface;
 *  - `within`: the same ring around a wrapper when something inside it has `:focus-visible` (a field with a trailing
 *    button), drawn by the wrapper;
 *  - `inset`: a ring drawn INSIDE the box, for a control flush with its container (a list row, a menu item) where an
 *    outer ring would be clipped; it has no gap, so it needs no surface;
 *  - `inverse`: a control on an inverse surface (the snackbar's action), ringed in `inverseAction`; the surface table has no
 *    inverse row, so there is no gap colour to read and the ring sits flush;
 *  - `floating`: a control over a photo or over scrolling content (the create button, a photo control) has no single
 *    surface, so its ring is two-tone: a 2 px `paperOverlay` inner band, then a 2 px `focusRing` ring, which reads on
 *    any background (WCAG 2.4.11 and 2.4.13).
 *
 * @pattern Style Recipe — one pure set of classes per focus-ring placement
 */
export const FOCUS_RING_CLASS = {
    offset:
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-(--cm-surface,var(--color-canvas))',
    within:
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring has-[:focus-visible]:ring-offset-2 ' +
        'has-[:focus-visible]:ring-offset-(--cm-surface,var(--color-canvas))',
    inset: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
    inverse: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-action',
    floating:
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ' +
        'focus-visible:ring-offset-paper-overlay',
} as const;
