import { expect } from 'vitest';

import { buttonSurfaceClass } from '@commise/ui/button';

/** The three surfaces a hand-built feature button was migrated onto (UI overhaul slice 2, step 12). */
type MigratedSurface = 'primary' | 'secondary' | 'ghost';

/**
 * Assert a control IS the design-system Button of one tier: it wears that tier's whole surface recipe (so a
 * hand-built control that merely looks close fails on the first missing token), and, when a glyph is named, it
 * draws that Lucide glyph from the Icon Registry.
 *
 * @param control - The rendered control.
 * @param surface - The Button tier it must wear.
 * @param glyph - The Lucide class suffix of its icon (`check` for `lucide-check`), or `null` for a ghost with none.
 */
export function expectDesignSystemButton(control: HTMLElement, surface: MigratedSurface, glyph: string | null): void {
    expect(control.className.split(/\s+/u)).toEqual(expect.arrayContaining(buttonSurfaceClass(surface).split(/\s+/u)));

    if (glyph !== null) {
        expect(control.querySelector(`svg.lucide-${glyph}`), `the ${glyph} glyph`).not.toBeNull();
    }
}
