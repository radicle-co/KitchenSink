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
 * motion — those are behaviour, and behaviour belongs to {@link import('./Button.js').Button}. Reach for the
 * component whenever the control CAN be a `<button>`; reach for this only when it cannot.
 */
import type { ButtonVariant } from './props.js';

/**
 * Tier-independent surface: pill geometry, the icon+label flex layout, the focus ring, the disabled
 * treatment, and the touch floor. The `min-h-11` (44px) floor is RESET at `md:` so the mouse density
 * (`py-2.5`, ~40px) is unchanged on desktop — a comfort bump for touch, not a desktop restyle.
 */
const BASE =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-body-sm ' +
    'font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light ' +
    'disabled:cursor-not-allowed disabled:opacity-60 md:min-h-0';

/**
 * Per-tier surface. Each tier renders a distinct, visible affordance — the whole point of the design-system
 * button is that none of them reads as plain text. (This map is the WEB idiom of the shared
 * {@link ButtonVariant} set; the native leaf carries its own StyleSheet mapping — the two change for
 * different reasons, so they are deliberately not merged.)
 */
const VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-gradient-to-br from-seafoam to-ocean-dark text-white shadow-sm hover:opacity-95',
    secondary: 'border border-border bg-white text-charcoal shadow-sm hover:bg-pearl',
    destructive: 'border border-error/40 bg-white text-error shadow-sm hover:bg-error/10',
};

/**
 * The design-system Button surface as a Tailwind class string. Pure.
 *
 * @param variant - The visual tier. Defaults to `primary`, matching the Button component's default.
 * @returns The `className` to apply to the control.
 */
export function buttonSurfaceClass(variant: ButtonVariant = 'primary'): string {
    return `${BASE} ${VARIANT[variant]}`;
}
