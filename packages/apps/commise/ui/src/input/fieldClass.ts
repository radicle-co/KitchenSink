/**
 * @module @commise/ui/input — the web class recipe for the design-system text-field surface (the "style recipe"
 * pattern of `button/surfaceClass.ts`: one pure function, no component attached), which `Input` and `TextArea` both
 * wear and a raw field that cannot be one of them (a Downshift combobox input, say) applies verbatim.
 *
 * The geometry is `docs/design/uiOverhaul/buildSpec.md` §1.6/§1.11: a 12 px rectangle (`rounded-md`; only the search
 * field is a pill), a 1 px `lineControl` edge (3.31:1 on paper, SC 1.4.11), at least 48 px tall, 16 px of padding, and
 * the `body` role, which never goes below 16 px so iOS Safari does not zoom. The placeholder is `inkMuted` (5.24:1),
 * never a hairline tone. An invalid field takes the `danger` edge from its own `aria-invalid`, so the state and its
 * styling cannot disagree. The `focusRing` and the 40% disabled state are the state matrix's (§1.10).
 */

/**
 * The text-field surface. It sets NO width and NO text colour: both land in the class attribute beside it, and the
 * stylesheet's emission order, not the order written, would decide a clash (V1 sign-off W-1). The leaf adds both.
 */
export const FIELD_CLASS =
    'min-h-12 rounded-md border border-line-control bg-paper px-4 py-3 text-body ' +
    'placeholder:text-ink-muted aria-invalid:border-danger focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-40';
