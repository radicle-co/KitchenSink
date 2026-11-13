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
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import { PRESS_FILL_CLASS } from '../surfaceTone/surfaceToneClass.js';
import type { ButtonGlyphTone, ButtonSize, ButtonVariant, DestructiveTone } from './props.js';

/**
 * Tier-independent surface: the icon+label flex row, the label type role (`cardTitle`, 16/20/600: owner ruling B1, 2026-10-26;
 * a separate `buttonLabel` role was held back because the design-artifact token table must list every role), the `focusRing` (2 px, 2 px off, §1.4), the
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
    'inline-flex shrink-0 max-w-full items-center justify-center gap-2 px-3 md:px-5 text-card-title transition ' +
    `${FOCUS_RING_CLASS.offset} ` +
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
 * ## The 44 px floor holds at EVERY width and for every pointer (owner ruling B1)
 *
 * `md` once reset its floor for a fine pointer at `md:` and up (E2 I12), which drew a desktop button 40 px (measured in
 * AppSnackbars). The owner's B1 allows 44 or 52 and nothing between, so the reset is gone: a mouse gets the same 44 px a
 * thumb does.
 *
 * ## `sm` draws 36 px and is hit at 44
 *
 * A transparent `::before` overlay extends the hit area four px above and below the visual box (SC 2.5.8 is met at
 * 24 px; 44 is the coarse-pointer floor this file keeps everywhere).
 */
const SIZE: Readonly<Record<ButtonSize, string>> = {
    lg: 'min-h-13 rounded-[calc(var(--spacing)*6.5)] py-3',
    md: 'min-h-11 rounded-[calc(var(--spacing)*5.5)] py-2.5',
    sm:
        "relative min-h-9 rounded-[calc(var(--spacing)*4.5)] py-1.5 before:content-[''] before:absolute " +
        'before:inset-x-0 before:-inset-y-1',
};

/**
 * Per-tier surface (§1.10). Hover is fine-pointer only by construction: Tailwind v4's `hover:` applies under
 * `(hover: hover)`. Pressed adds the motion-safe 0.98 scale `PressScale` owns.
 *
 * Every colour is a ROLE (D15), so each tier re-themes through the dark block. Hover and press fill with
 * `surfaceMuted`, the pressed fill over paper and sheets (`componentFixes` issue 3, 2026-10-26); the `ink` 6% wash is
 * dropped. Over a `surfaceMuted` fill (a chip) the pressed fill is `lineDivider` instead (`chipClass.ts`).
 *
 * - `primary`: ONE flat `action` fill (the owner removed the gradient, `modernizeB.md` §3) under an `onAction` label
 *   (4.67:1), `actionPressed` on hover and press.
 * - `secondary`: NEUTRAL — `paper`, a `lineControl` edge (SC 1.4.11), an `ink` label. ⚠️ This REPLACES the mockups'
 *   coral-outlined glass: the owner overruled coral on every control.
 * - `ghost`: an `actionText` label with no surface at rest.
 * - `quiet`: an `ink` label with no surface at rest, its glyph in `actionText` ({@link buttonGlyphClass}). It takes the
 *   same `surfaceMuted` press fill as every other tier, so a mouse still sees the control respond, and nothing
 *   depends on that hover. It has no tonal fill, because that fill now marks a chip (`componentFixes.md` §4).
 * - `destructive` inline: a `dangerText` label on the neutral surface; `confirm`: the `danger` fill with an `onAction`
 *   label (4.66:1), which only a confirm dialog's action takes (§1.11). Its press paints `dangerPressed`:
 *   `dangerText` is a light red in the dark theme and cannot be a fill.
 */
const SURFACE = {
    primary: 'bg-action text-on-action shadow-sm hover:bg-action-pressed active:bg-action-pressed',
    secondary: 'border border-line-control bg-paper text-ink',
    ghost: 'text-action-text',
    quiet: 'text-ink',
    destructiveInline: 'border border-line-control bg-paper text-danger-text',
    destructiveConfirm: 'bg-danger text-on-action shadow-sm hover:bg-danger-pressed active:bg-danger-pressed',
} as const;

/**
 * The surfaces whose press is the neutral fill, which they READ from the surface they sit on
 * (`PRESS_FILL_CLASS.pointer`, `componentFixes.md` §10: ink laid over that surface's fill, so it shows on paper, on a
 * sheet and on a muted card alike). A filled tier presses by darkening instead and has no entry here.
 */
const NEUTRAL_PRESS: ReadonlySet<keyof typeof SURFACE> = new Set(['secondary', 'ghost', 'quiet', 'destructiveInline']);

/** A tier's surface classes with its press fill. Pure. */
function surfaceClassOf(key: keyof typeof SURFACE): string {
    return NEUTRAL_PRESS.has(key) ? `${SURFACE[key]} ${PRESS_FILL_CLASS.pointer}` : SURFACE[key];
}

/**
 * The class a tier's glyph (and its busy spinner) takes beyond `currentColor`, which is its label's colour: the web
 * adapter of the glyph colour. `quiet` always parts the two, an `ink` label with an `actionText` glyph, the cue that a
 * control with no surface is pressable. Any other tier takes `actionText` only under the `action` glyph tone, which
 * `glyphToneOf` decides: that policy owns WHEN a glyph is steel, and only the secondary tier's type can ask for it.
 * Pure.
 *
 * @param variant - The tier.
 * @param glyphTone - The resolved glyph tone, from `glyphToneOf`. Defaults to `label`.
 * @returns A Tailwind colour utility, or `''` when the glyph takes its label's colour.
 */
export function buttonGlyphClass(variant: ButtonVariant, glyphTone: ButtonGlyphTone = 'label'): string {
    return variant === 'quiet' || glyphTone === 'action' ? 'text-action-text' : '';
}

/** The surface key a tier and tone select. Pure. */
function surfaceKey(variant: ButtonVariant, tone: DestructiveTone): keyof typeof SURFACE {
    if (variant !== 'destructive') {
        return variant;
    }

    return tone === 'confirm' ? 'destructiveConfirm' : 'destructiveInline';
}

/** What a Button surface takes besides its tier. */
export interface ButtonSurfaceOptions {
    /** The size. Defaults to `md`. */
    readonly size?: ButtonSize;
}

/** What a destructive Button surface takes besides its size. */
export interface DestructiveSurfaceOptions extends ButtonSurfaceOptions {
    /** `inline` (the default) or the filled `confirm` surface of a confirm dialog's action. */
    readonly tone?: DestructiveTone;
}

/**
 * The design-system Button surface as a Tailwind class string. Pure.
 *
 * It takes no surface: the press fill and the focus-ring gap are read from the surface the control sits on
 * (`surfaceToneClass`), so a control is correct wherever it is placed.
 *
 * @param variant - The tier. Defaults to `primary`, matching the Button component's default.
 * @param options - The size (default `md`).
 * @returns The `className` to apply to the control.
 */
export function buttonSurfaceClass(
    variant?: Exclude<ButtonVariant, 'destructive'>,
    options?: ButtonSurfaceOptions,
): string;
/**
 * The destructive Button surface as a Tailwind class string. Pure.
 *
 * @param variant - `destructive`.
 * @param options - The size (default `md`) and the tone: `inline` (the default) or the filled `confirm`.
 * @returns The `className` to apply to the control.
 */
export function buttonSurfaceClass(variant: 'destructive', options?: DestructiveSurfaceOptions): string;

export function buttonSurfaceClass(
    variant: ButtonVariant = 'primary',
    options: DestructiveSurfaceOptions = {},
): string {
    const { size = 'md', tone = 'inline' } = options;

    return `${BASE} ${SIZE[size]} ${surfaceClassOf(surfaceKey(variant, tone))}`;
}

/**
 * The surface of a SWITCH that wears the secondary button (`componentFixes` issue 6): "Screen on". Unselected it IS the
 * secondary surface, byte for byte. Selected it takes the `selectedFill` with a `selectedEdge` outline and holds the
 * same 1 px edge width, so turning it on moves nothing around it; the label stays `ink`. Pressing while on shows a 2 px
 * `selectedEdge` (`componentFixes` §5): a 1 px inset ring over the 1 px border, so the box does not move. Pure.
 *
 * @param selected - Whether the switch is on.
 * @param size - The size. Defaults to `md`.
 * @returns The `className` to apply to the control.
 */
export function buttonToggleSurfaceClass(selected: boolean, size: ButtonSize = 'md'): string {
    return selected
        ? `${BASE} ${SIZE[size]} border border-selected-edge bg-selected-fill text-ink active:ring-1 active:ring-inset active:ring-selected-edge`
        : buttonSurfaceClass('secondary', { size });
}
