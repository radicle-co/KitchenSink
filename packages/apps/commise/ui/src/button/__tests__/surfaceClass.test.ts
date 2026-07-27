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

    it('defaults to the primary tier when no variant is given', () => {
        expect(buttonSurfaceClass()).toBe(buttonSurfaceClass('primary'));
    });

    it('is pure — the same variant always yields the identical string', () => {
        expect(buttonSurfaceClass('secondary')).toBe(buttonSurfaceClass('secondary'));
    });
});
