import { expect } from 'vitest';

import { role } from '@commise/ui/colors';

import { cssColor } from './cssColor.js';

/** The three surfaces a hand-built native feature button was migrated onto (UI overhaul slice 2, step 12). */
type MigratedSurface = 'primary' | 'secondary' | 'ghost';

/** The painted surface inside a control: the first element carrying a radius (react-native-web atomic CSS). */
function surfaceOf(control: HTMLElement): CSSStyleDeclaration {
    const painted = [control, ...Array.from(control.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (painted === undefined) {
        throw new Error(`"${control.getAttribute('aria-label') ?? ''}" paints no rounded surface.`);
    }

    return getComputedStyle(painted);
}

/**
 * Assert a native control (rendered through react-native-web) IS the design-system Button of one tier: primary paints
 * the flat `action` fill, secondary the `paper` fill with a 1pt `lineControl` edge, ghost neither; and, when a glyph is
 * named, it draws that Lucide glyph through the `lucideNativeStub` stand-in.
 *
 * @param control - The rendered control.
 * @param surface - The Button tier it must wear.
 * @param glyph - The Lucide glyph file name (`rotate-ccw`), or `null` for a control with none.
 */
export function expectNativeDesignSystemButton(
    control: HTMLElement,
    surface: MigratedSurface,
    glyph: string | null,
): void {
    const painted = surfaceOf(control);
    const fill: Readonly<Record<MigratedSurface, string>> = {
        primary: cssColor(role.action),
        secondary: cssColor(role.paper),
        ghost: 'rgba(0, 0, 0, 0)',
    };

    // Every tier is ONE flat surface since the owner removed the primary gradient (`modernizeB.md` §3).
    expect(control.querySelector('[data-commise-stub="linear-gradient"]'), 'no gradient on any tier').toBeNull();
    expect(painted.backgroundColor).toBe(fill[surface]);
    expect(painted.borderTopWidth).toBe(surface === 'secondary' ? '1px' : '0px');

    if (surface === 'secondary') {
        expect(painted.borderTopColor).toBe(cssColor(role.lineControl));
    }

    if (glyph !== null) {
        expect(control.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe(glyph);
    }
}
