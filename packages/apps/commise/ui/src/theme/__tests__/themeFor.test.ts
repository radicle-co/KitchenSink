import { describe, expect, it } from 'vitest';

import { role, roleDark, tint } from '../../tokens/colors.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';
import { gradient, heroDark } from '../../tokens/gradients.js';
import { statusTone, statusToneDark } from '../../tokens/tones.js';
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

    // `darkTheme.md` §1, "Pressed and hover": a wash of `ink` at 6%, the native twin of the web `bg-ink/6`.
    it('derives the press wash from each scheme’s ink', () => {
        expect(themeFor('light').wash).toBe(tint(role.ink, 0.06));
        expect(themeFor('dark').wash).toBe(tint(roleDark.ink, 0.06));
    });

    it('returns the same object for the same scheme', () => {
        expect(themeFor('dark')).toBe(themeFor('dark'));
    });
});
