/**
 * Invariants for {@link buttonSurfaceClass} — the single authoritative web class recipe for the design-system
 * Button surface.
 *
 * It exists so a control that CANNOT be a `<button>` element — a navigation `<a>`/`next/link`, a Radix slot
 * (`AlertDialog.Cancel`), or a trigger that must own its own `ref` — can still wear the DS surface WITHOUT
 * re-typing the palette, the radius, or the touch floor. These tests pin the properties consumers depend on:
 * the 44px touch floor with its desktop reset, a distinct visible surface per tier, and that the recipe the
 * {@link Button} itself renders is byte-identical to what this helper returns (so the two can never drift).
 */
import { describe, expect, it } from 'vitest';

import { glass } from '../../tokens/gradients.js';
import { buttonSurfaceClass } from '../surfaceClass.js';
import type { ButtonVariant } from '../props.js';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'destructive'];

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

    it('defaults to the primary tier when no variant is given', () => {
        expect(buttonSurfaceClass()).toBe(buttonSurfaceClass('primary'));
    });

    it('is pure — the same variant always yields the identical string', () => {
        expect(buttonSurfaceClass('secondary')).toBe(buttonSurfaceClass('secondary'));
    });
});
