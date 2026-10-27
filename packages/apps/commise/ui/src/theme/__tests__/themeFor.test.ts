import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';
import { gradient, heroDark } from '../../tokens/gradients.js';
import { proTone, proToneDark, statusTone, statusToneDark } from '../../tokens/tones.js';
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

    // REWRITTEN for ruling 3 (`componentFixes` issue 3, 2026-10-26): the press wash was `ink` at 6% (`darkTheme.md` §1).
    // Over paper and sheets the pressed fill is now each scheme's `surfaceMuted`, the native twin of `bg-surface-muted`.
    it('presses to each scheme’s surfaceMuted, not an ink-alpha wash', () => {
        expect(themeFor('light').wash).toBe(role.surfaceMuted);
        expect(themeFor('dark').wash).toBe(roleDark.surfaceMuted);
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
