/**
 * The level-2 bar material (`docs/design/uiOverhaul/darkTheme.md` §3.4 and §4; ownerDecisions D12): the web tab bar and
 * condensed title bar paint `paper` at 92% in light and `paperRaised` at 94% in dark, each readable with the blur off.
 * One value per theme, emitted as `--color-bar` and overridden by the dark block, so no component needs `dark:`.
 */
import { describe, expect, it } from 'vitest';

import { barMaterial } from '../barMaterial.js';
import { role, roleDark, tint } from '../colors.js';
import { themeCss } from '../themeCss.js';

const css = themeCss();
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');

describe('barMaterial', () => {
    it('is paper at 92% in light and paperRaised at 94% in dark (darkTheme.md §3.4)', () => {
        expect(barMaterial.light).toBe(tint(role.paper, 0.92));
        expect(barMaterial.dark).toBe(tint(roleDark.paperRaised, 0.94));
    });

    it('is declared in @theme with its light value, as a colour Tailwind makes `bg-bar` from', () => {
        const declaration = `--color-bar: ${barMaterial.light};`;

        expect(css.indexOf(declaration)).toBeGreaterThan(-1);
        expect(css.indexOf(declaration)).toBeLessThan(darkStart);
    });

    it('is overridden with its dark value inside the dark block', () => {
        expect(css.slice(darkStart)).toContain(`--color-bar: ${barMaterial.dark};`);
    });
});
