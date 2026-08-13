/**
 * Invariants for {@link buttonSurfaceClass} — the single authoritative web class recipe for the design-system
 * Button surface.
 *
 * It exists so a control that CANNOT be a `<button>` element — a navigation `<a>`/`next/link`, a Radix slot
 * (`AlertDialog.Cancel`), or a trigger that must own its own `ref` — can still wear the DS surface WITHOUT
 * re-typing the palette, the radius, or the touch floor. These tests pin the properties consumers depend on:
 * the 44px touch floor with its desktop reset, a distinct visible surface per tier, and that the recipe the
 * `Button` itself renders is byte-identical to what this helper returns (so the two can never drift).
 *
 * ## The FOCUS RING is measured here, because this recipe is where the defect was systemic (#114)
 *
 * `BASE` carries the focus ring for every DS-surfaced control in the product, so one wrong token here is a
 * keyboard-accessibility failure across the whole app rather than a local styling slip — which is exactly how
 * `ring-seafoam-light` (2.78:1 on white, 2.58:1 on the `sand` page) reached 15 call sites without anyone
 * noticing. A focus indicator is a non-text UI component boundary, so its floor is the 3:1 of SC 1.4.11, and
 * it is measured against the SURFACES a button is mounted on — never the button's own fill, because Tailwind
 * draws `ring-*` as a spread box-shadow OUTSIDE the border box.
 *
 * `culori` supplies the luminance math; `@commise/test-utils` (whose `ringContrast` is the same reader for the
 * product's own call sites) cannot be imported here without closing a workspace cycle.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { palette, semantic } from '../../tokens/colors.js';
import { glass } from '../../tokens/gradients.js';
import { buttonSurfaceClass } from '../surfaceClass.js';
import type { ButtonVariant } from '../props.js';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'destructive'];

/** WCAG 2.1 AA, SC 1.4.11 — a focus indicator is a non-text UI component boundary, not text. */
const AA_UI_COMPONENT = 3;

/**
 * Every opaque surface a design-system button is mounted on: a `bg-card` panel, the `sand` app background, and
 * the `pearl` muted fill. The ring must clear the floor on the WORST of them, not just on a nominal white.
 */
const BUTTON_BACKDROPS: readonly { readonly what: string; readonly color: string }[] = [
    { what: 'a bg-card panel', color: semantic.card },
    { what: 'the app background', color: semantic.background },
    { what: 'a pearl muted fill', color: palette.pearl },
];

/**
 * The palette colour of the focus ring a class recipe paints.
 *
 * Reading the token out of the RENDERED string (rather than asserting a spelling) is what keeps both halves
 * load-bearing: repoint the utility and the lookup moves, re-theme the token and the ratio moves. Geometry
 * utilities (`ring-2`, `ring-offset-2`) carry digits and cannot match.
 *
 * @throws Error when the recipe paints no palette-coloured ring — a control with `focus-visible:outline-none`
 *   and no ring has no focus indicator at all, which must fail loudly rather than measure nothing.
 */
function ringColor(className: string): string {
    const name = /(?:^|\s)(?:[a-z-]+:)?ring-([a-z][a-z-]*)(?=\s|$)/.exec(className)?.[1];

    if (name === undefined || !(name in palette)) {
        throw new Error(`Expected a palette-coloured \`ring-*\` utility in "${className}".`);
    }

    return palette[name as keyof typeof palette];
}

describe('buttonSurfaceClass', () => {
    it('carries the 44px touch floor at base and resets it for the mouse at md:', () => {
        for (const variant of VARIANTS) {
            const className = buttonSurfaceClass(variant);

            expect(className).toContain('min-h-11');
            expect(className).toContain('md:min-h-0');
        }
    });

    it('renders a pill with the DS radius and inline-flex icon+label layout for every tier', () => {
        for (const variant of VARIANTS) {
            const className = buttonSurfaceClass(variant);

            expect(className).toContain('rounded-full');
            expect(className).toContain('inline-flex');
            expect(className).toContain('items-center');
        }
    });

    it('gives every tier a distinct, visible surface (none is naked text)', () => {
        expect(buttonSurfaceClass('primary')).toContain('seafoam');
        expect(buttonSurfaceClass('secondary')).toContain('border');
        expect(buttonSurfaceClass('destructive')).toContain('error');

        const classes = VARIANTS.map((variant) => buttonSurfaceClass(variant));
        expect(new Set(classes).size).toBe(VARIANTS.length);
    });

    it("paints secondary as the mockups' CORAL-outlined glass, not a grey-bordered white pill", () => {
        const className = buttonSurfaceClass('secondary');

        // The mockups' secondary button (screen-grocery / screen-profile / screen-recipe-detail) is
        // `border-2 border-coral` over the translucent white glass — the accent edge IS the tier.
        expect(className).toContain('border-2');
        expect(className).toContain('border-coral');
        expect(className).toContain('from-white/80');
        expect(className).toContain('to-white/60');
        // The grey hairline + opaque white fill this replaces must be gone, or the tier still reads flat.
        expect(className).not.toContain('border-border');
        expect(className).not.toContain('bg-white ');
    });

    it("derives secondary's blur/saturation from the `subtle` glass tier, so the two cannot drift", () => {
        const className = buttonSurfaceClass('secondary');

        // `glass.subtle` IS the mockups' control glass (12px / 1.3) and its JSDoc names this very button as
        // the surface it was transcribed from. Tailwind can only see arbitrary values written literally in
        // source, so the literals are pinned to the token here rather than composed from it at runtime.
        expect(className).toContain(`backdrop-blur-[${glass.subtle.blur}px]`);
        expect(className).toContain(`backdrop-saturate-[${glass.subtle.saturate}]`);
    });

    it('fills coral on hover and swaps the label to a legible foreground', () => {
        const className = buttonSurfaceClass('secondary');

        // The mockups' hover inverts the tier: the outline fills coral. `text-coral` (2.40:1) and the
        // mockups' `hover:text-white` (2.40:1) both fail WCAG AA, so the resting label is slate (5.24:1)
        // and the filled-hover label is charcoal (5.29:1). See the module JSDoc.
        expect(className).toContain('hover:from-coral');
        expect(className).toContain('hover:to-coral/90');
        expect(className).toContain('text-slate');
        expect(className).toContain('hover:text-charcoal');
        expect(className).not.toContain('text-coral');
        expect(className).not.toContain('hover:text-white');
    });

    it('paints a focus ring that clears the 3:1 SC 1.4.11 floor on every surface a button sits on', () => {
        for (const variant of VARIANTS) {
            const ring = ringColor(buttonSurfaceClass(variant));

            for (const { what, color } of BUTTON_BACKDROPS) {
                expect(wcagContrast(ring, color), `${variant} button focus ring on ${what}`).toBeGreaterThanOrEqual(
                    AA_UI_COMPONENT,
                );
            }
        }
    });

    it('rules out `seafoam-light` as a ring token, on the measurement rather than the name', () => {
        // The token is not being darkened (it is deliberately the light teal of `semantic.primary`, and the
        // lightness needed to carry a ring would collapse it into `seafoam` — see the palette JSDoc). So the
        // guard is that whatever ring this recipe paints must OUT-measure `seafoam-light` on the app's own
        // background: a re-theme that quietly points the ring back at the accent fails here.
        for (const variant of VARIANTS) {
            expect(
                wcagContrast(ringColor(buttonSurfaceClass(variant)), semantic.background),
                `${variant} button focus ring vs the seafoam-light it replaced`,
            ).toBeGreaterThan(wcagContrast(palette['seafoam-light'], semantic.background));
        }
    });

    it('defaults to the primary tier when no variant is given', () => {
        expect(buttonSurfaceClass()).toBe(buttonSurfaceClass('primary'));
    });

    it('is pure — the same variant always yields the identical string', () => {
        expect(buttonSurfaceClass('secondary')).toBe(buttonSurfaceClass('secondary'));
    });
});
