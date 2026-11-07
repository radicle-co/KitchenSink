/**
 * A web chip inside a paperRaised Surface, resolved through the stylesheet (`componentFixes.md` §10b). jsdom has no
 * cascade, so the chain is walked by hand: the chip's rest class reads `--cm-chip-fill`, the Surface's class sets it to a
 * tone property, and `themeCss()` gives that property its value in each theme. In dark, paperRaised paints the same colour
 * as surfaceMuted, so a chip that rested on surfaceMuted there would be invisible.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Chip } from '../../chip/Chip.js';
import { role, roleDark } from '../../tokens/colors.js';
import { themeCss } from '../../tokens/themeCss.js';
import { CHIP_FILL_VAR } from '../surfaceTone.js';
import { Surface } from '../Surface.js';

afterEach(cleanup);

/** The value a custom property is finally given in one theme's block, following `var()` once. */
function resolved(property: string, scheme: 'light' | 'dark'): string {
    const css = themeCss();
    const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
    const block = scheme === 'light' ? css.slice(0, darkStart) : css.slice(darkStart);
    const value = new RegExp(`${property}: (#[0-9a-fA-F]{6});`, 'u').exec(block)?.[1];

    if (value === undefined) {
        throw new Error(`${property} is not declared in the ${scheme} block.`);
    }

    return value.toLowerCase();
}

describe('a chip on a paperRaised Surface (web)', () => {
    it('rests on the surface’s chip fill, and the fill differs from the surface in both themes', () => {
        render(
            <Surface tone="paperRaised">
                <Chip kind="filter" label="Vegan" selected={false} onPress={() => undefined} />
            </Surface>,
        );
        const chip = screen.getByRole('button', { name: 'Vegan' });
        const surface = chip.parentElement;
        const property = new RegExp(`\\[${CHIP_FILL_VAR}:var\\((--[a-z-]+)\\)\\]`, 'u').exec(
            surface?.className ?? '',
        )?.[1];

        expect(chip.className).toContain(`bg-(${CHIP_FILL_VAR},`);
        expect(property).toBeDefined();
        expect(resolved(property ?? '', 'light')).toBe(role.surfaceMuted.toLowerCase());
        expect(resolved(property ?? '', 'dark')).toBe(roleDark.paper.toLowerCase());
        expect(resolved(property ?? '', 'dark')).not.toBe(roleDark.paperRaised.toLowerCase());
    });
});
