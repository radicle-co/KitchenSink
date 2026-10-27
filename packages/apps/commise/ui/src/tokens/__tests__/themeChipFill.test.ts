/**
 * The chip fills reach the web as custom properties (`--color-chip-fill-<tone>` and `--color-chip-press-<tone>`), light in
 * `@theme` and dark in the one `prefers-color-scheme: dark` block, so a chip follows the theme with no `dark:` variant.
 * The value of each is the colour of the role the table names for that tone AND theme (`chipFillRoleOf`), and the press is
 * the press of the surface that fill is (`chipPressToneOf`), so web and native cannot disagree.
 *
 * Mutation lens: emit the light fill in the dark block, skip a tone, or declare one twice, and a test below fails.
 */
import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../colors.js';
import {
    chipFillRoleOf,
    chipFillVarOf,
    chipPressToneOf,
    chipPressVarOf,
    pressFillsOf,
    SURFACE_TONE_NAMES,
} from '../../surfaceTone/surfaceTone.js';
import { themeCss } from '../themeCss.js';

const css = themeCss();
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const THEMES = {
    light: { block: css.slice(0, darkStart), colors: role },
    dark: { block: css.slice(darkStart), colors: roleDark },
} as const;

describe('themeCss — the chip fills', () => {
    for (const [scheme, { block, colors }] of Object.entries(THEMES)) {
        const s = scheme as 'light' | 'dark';
        const press = pressFillsOf(colors, s);

        for (const tone of SURFACE_TONE_NAMES) {
            it(`${scheme} ${tone}: declares the fill and the press once, from the table`, () => {
                expect(block).toContain(`${chipFillVarOf(tone)}: ${colors[chipFillRoleOf(tone, s)]};`);
                expect(block).toContain(`${chipPressVarOf(tone)}: ${press[chipPressToneOf(tone, s)]};`);
                expect(block.split(`${chipFillVarOf(tone)}:`)).toHaveLength(2);
                expect(block.split(`${chipPressVarOf(tone)}:`)).toHaveLength(2);
            });
        }
    }

    it('dark paperRaised: the chip fill is not the surface’s own fill (§10b: it was invisible)', () => {
        expect(THEMES.dark.block).toContain(`${chipFillVarOf('paperRaised')}: ${roleDark.paper};`);
        expect(roleDark.paper).not.toBe(roleDark.paperRaised);
    });
});
