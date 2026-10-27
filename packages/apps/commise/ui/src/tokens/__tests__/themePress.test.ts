/**
 * The press fills reach the web as custom properties (`--color-press-<tone>`), light in `@theme` and dark in the one
 * `prefers-color-scheme: dark` block, so a utility that reads them follows the theme with no `dark:` variant. They are
 * emitted FROM `pressFillsOf` (the derivation `surfaceTone.test.ts` pins), so the stylesheet and a native theme cannot
 * disagree. Mutation lens: emit the light value in the dark block, or skip a tone, and a test below fails.
 */
import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../colors.js';
import { pressFillsOf, pressVarOf, SURFACE_TONE_NAMES } from '../../surfaceTone/surfaceTone.js';
import { themeCss } from '../themeCss.js';

const css = themeCss();
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = css.slice(0, darkStart);
const dark = css.slice(darkStart);

describe('themeCss — the press fills', () => {
    for (const tone of SURFACE_TONE_NAMES) {
        it(`${tone}: light in @theme and dark in the dark block`, () => {
            expect(light).toContain(`${pressVarOf(tone)}: ${pressFillsOf(role, 'light')[tone]};`);
            expect(dark).toContain(`${pressVarOf(tone)}: ${pressFillsOf(roleDark, 'dark')[tone]};`);
        });

        it(`${tone}: is declared once per theme`, () => {
            expect(light.split(`${pressVarOf(tone)}:`)).toHaveLength(2);
            expect(dark.split(`${pressVarOf(tone)}:`)).toHaveLength(2);
        });
    }
});
