import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';
import { gradient, heroDark } from '../../tokens/gradients.js';
import { proTone, proToneDark, statusTone, statusToneDark } from '../../tokens/tones.js';
import { pressFillsOf } from '../../surfaceTone/surfaceTone.js';
import { themeFor } from '../themeFor.js';

/**
 * `themeFor` — the one place native picks a theme's colours (`docs/design/uiOverhaul/darkTheme.md` §7.1–7.2): the
 * light records for `light`, the dark ones for `dark`, as ONE stable object per scheme so a component that memoises
 * on the theme re-renders only when the scheme changes.
 */
describe('themeFor', () => {
    it('gives the light records for light', () => {
        const theme = themeFor('light');

        expect(theme.scheme).toBe('light');
        expect(theme.colors).toBe(role);
        expect(theme.covers).toBe(coverTint);
        expect(theme.hero).toBe(gradient.hero);
        expect(theme.status).toBe(statusTone);
    });

    it('gives the dark records for dark', () => {
        const theme = themeFor('dark');

        expect(theme.scheme).toBe('dark');
        expect(theme.colors).toBe(roleDark);
        expect(theme.covers).toBe(coverTintDark);
        expect(theme.hero).toBe(heroDark);
        expect(theme.status).toBe(statusToneDark);
    });

    // REWRITTEN (`componentFixes.md` §10a): the single `wash` is gone; each surface has its own derived press (below).
    it('has no single wash any more: a press belongs to a surface', () => {
        expect('wash' in themeFor('light')).toBe(false);
        expect('wash' in themeFor('dark')).toBe(false);
    });

    // The native PRO badge reads its pair from the theme, so the dark scheme paints the dark pair (it used to read the
    // light constant in both).
    it('gives each scheme its own PRO pair', () => {
        expect(themeFor('light').pro).toBe(proTone);
        expect(themeFor('dark').pro).toBe(proToneDark);
    });

    it('returns the same object for the same scheme', () => {
        expect(themeFor('dark')).toBe(themeFor('dark'));
    });
});

describe('themeFor — the press fills', () => {
    it('carries each surface’s derived press, light and dark', () => {
        expect(themeFor('light').press).toEqual(pressFillsOf(role, 'light'));
        expect(themeFor('dark').press).toEqual(pressFillsOf(roleDark, 'dark'));
    });
});
