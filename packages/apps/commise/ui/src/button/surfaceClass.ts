/**
 * @module @commise/ui/button — the web class recipe for the design-system Button surface (the "style recipe"
 * pattern: one pure `variant → className` function, no component attached).
 *
 * ## Why this is a separate export and not private to `Button.tsx`
 *
 * `Button` renders a `<button>`. Several DS-surfaced controls legitimately CANNOT be that element:
 *
 *  - a **navigation** control must stay an `<a>` / `next/link`, or it loses link semantics — the `link` role,
 *    middle-click / ⌘-click, the status-bar target preview, and "open in new tab". Turning a navigation into a
 *    `<button onClick={router.push}>` purely to reach the DS palette is an accessibility regression, not a
 *    migration;
 *  - a **Radix slot** (`AlertDialog.Cancel`, `Dialog.Close`) owns its own element and behaviour;
 *  - a trigger that must hold its own **`ref`** (focus return, outside-click containment) cannot go through a
 *    component that does not forward one.
 *
 * Without this helper each of those hand-rolls the palette, the radius, and the touch floor — which is exactly
 * the drift the design system exists to prevent. So the surface is defined ONCE here, `Button.tsx` consumes it
 * verbatim (a test pins that equality), and every non-`<button>` control applies the same string.
 *
 * The string is web-only (Tailwind utilities over `@commise/ui` tokens). It is exported from the shared
 * `@commise/ui/button` barrel following the same convention as the `className` prop in the shared component
 * contracts: a platform-specific hook that the platform which understands it consumes, and the other ignores.
 *
 * NOTE: this returns the SURFACE only. It does not supply the icon slot, the busy spinner, or the press-scale
 * motion — those are behaviour, and behaviour belongs to `Button`. Reach for the
 * component whenever the control CAN be a `<button>`; reach for this only when it cannot.
 */
import { BUSY_CONTROL_CLASS } from './busyControlProps.js';
import type { ButtonSize, ButtonVariant, DestructiveTone } from './props.js';

/**
 * Tier-independent surface: the icon+label flex row, the label type role, the `focusRing` (2 px, 2 px off, §1.4), the
 * 40% disabled state (§1.10) and the busy (`aria-disabled`) treatment.
 *
 * ## `shrink-0 max-w-full` — a row wraps between controls, never inside one (F5)
 *
 * A flex item's minimum is its min-content, so a crowded row squeezed "Sort: Recently edited" to three lines at every
 * width. `shrink-0` holds a button at its label's width; the ROW must then wrap or re-lay out (§1.1, rung 1).
 * `max-w-full` caps it at its container, so a label longer than the whole container (200% text, §1.1's standing
 * exception) still wraps inside the box rather than overflowing the page.
 *
 * ## `px-3 md:px-5` — horizontal room is the scarce dimension on a phone
 *
 * ⛔ Measured in Chromium on the real geometry: three actions in one row at `px-5` need 383px against 288 available at
 * 320, so the label wrapped and the primary was clipped off the right edge. At `px-3` the same row fits with 27px to
 * spare. `px-4` was measured too and REJECTED at 3px of slack. It is the BASE rather than a per-caller override because
 * the constraint is systemic: any row of three actions on a narrow viewport hits it.
 */
const BASE =
    'inline-flex shrink-0 max-w-full items-center justify-center gap-2 px-3 md:px-5 text-label transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ' +
    `disabled:cursor-not-allowed disabled:opacity-40 ${BUSY_CONTROL_CLASS}`;

/**
 * The edge class of a ghost text button that STARTS a line in a column — the eyebrow back link, Version history: a
 * negative start margin equal to {@link BASE}'s inline padding, so the LABEL, not the box, sits on the column edge its
 * sibling headings share (F15). Kept beside `BASE` because the two change together; a test derives one from the other.
 * Only for a button that starts a line: inside a row of controls, the box is what aligns.
 */
export const GHOST_EDGE_CLASS = '-ms-3 md:-ms-5';

/**
 * Per-size geometry (§1.6: 52, 44 and 36 visual px).
 *
 * ## The radius is HALF the height, not a full pill (E2 I2, kept against spec §1.6)
 *
 * Each `rounded-[calc(var(--spacing)*N)]` is half its size's `min-h-*` on the same `--spacing` base, so the two move
 * together. On one line the browser clamps the radius to half the box, which still draws a pill. A label that wraps
 * (200% text) makes a rounded rectangle, so its words stay inside the curve; on a full pill they ran past it.
 *
 * ## `md` resets its floor only for a fine pointer (E2 I12)
 *
 * A width breakpoint stood in for "has a mouse", and a touch iPad at 768 px and wider got a 41 px target. The reset now
 * needs BOTH `md:` and `pointer: fine`, so a touch screen keeps 44 px at every width and a desktop keeps its density.
 *
 * ## `sm` draws 36 px and is hit at 44
 *
 * A transparent `::before` overlay extends the hit area four px above and below the visual box (SC 2.5.8 is met at
 * 24 px; 44 is the coarse-pointer floor this file keeps everywhere).
 */
const SIZE: Readonly<Record<ButtonSize, string>> = {
    lg: 'min-h-13 rounded-[calc(var(--spacing)*6.5)] py-3',
    md: 'min-h-11 rounded-[calc(var(--spacing)*5.5)] py-2.5 md:pointer-fine:min-h-0',
    sm:
        "relative min-h-9 rounded-[calc(var(--spacing)*4.5)] py-1.5 before:content-[''] before:absolute " +
        'before:inset-x-0 before:-inset-y-1',
};

/**
 * Per-tier surface (§1.10). Hover is fine-pointer only by construction: Tailwind v4's `hover:` applies under
 * `(hover: hover)`. Pressed adds the motion-safe 0.98 scale `PressScale` owns.
 *
 * Every colour is a ROLE (D15), so each tier re-themes through the dark block; hover and press are an `ink` wash at
 * 6% (`darkTheme.md` §1).
 *
 * - `primary`: ONE flat `action` fill (the owner removed the gradient, `modernizeB.md` §3) under an `onAction` label
 *   (4.67:1), `actionPressed` on hover and press.
 * - `secondary`: NEUTRAL — `paper`, a `lineControl` edge (SC 1.4.11), an `ink` label. ⚠️ This REPLACES the mockups'
 *   coral-outlined glass: the owner overruled coral on every control.
 * - `ghost`: an `actionText` label with no surface at rest.
 * - `destructive` inline: a `dangerText` label on the neutral surface; `confirm`: the `danger` fill with an `onAction`
 *   label (4.66:1), which only a confirm dialog's action takes (§1.11). Its press darkens the fill (`danger/90`):
 *   `dangerText` is a light red in the dark theme and cannot be a fill.
 */
const SURFACE = {
    primary: 'bg-action text-on-action shadow-sm hover:bg-action-pressed active:bg-action-pressed',
    secondary: 'border border-line-control bg-paper text-ink hover:bg-ink/6 active:bg-ink/6',
    ghost: 'text-action-text hover:bg-ink/6 active:bg-ink/6',
    destructiveInline: 'border border-line-control bg-paper text-danger-text hover:bg-ink/6 active:bg-ink/6',
    destructiveConfirm: 'bg-danger text-on-action shadow-sm hover:bg-danger/90 active:bg-danger/90',
} as const;

/** The surface key a tier and tone select. Pure. */
function surfaceKey(variant: ButtonVariant, tone: DestructiveTone): keyof typeof SURFACE {
    if (variant !== 'destructive') {
        return variant;
    }

    return tone === 'confirm' ? 'destructiveConfirm' : 'destructiveInline';
}

/**
 * The design-system Button surface as a Tailwind class string. Pure.
 *
 * @param variant - The tier. Defaults to `primary`, matching the Button component's default.
 * @param size - The size. Defaults to `md`.
 * @returns The `className` to apply to the control.
 */
export function buttonSurfaceClass(variant?: Exclude<ButtonVariant, 'destructive'>, size?: ButtonSize): string;
/**
 * The destructive Button surface as a Tailwind class string. Pure.
 *
 * @param variant - `destructive`.
 * @param size - The size. Defaults to `md`.
 * @param tone - `inline` (the default) or `confirm`, the filled surface of a confirm dialog's action.
 * @returns The `className` to apply to the control.
 */
export function buttonSurfaceClass(variant: 'destructive', size?: ButtonSize, tone?: DestructiveTone): string;

export function buttonSurfaceClass(
    variant: ButtonVariant = 'primary',
    size: ButtonSize = 'md',
    tone: DestructiveTone = 'inline',
): string {
    return `${BASE} ${SIZE[size]} ${SURFACE[surfaceKey(variant, tone)]}`;
}
