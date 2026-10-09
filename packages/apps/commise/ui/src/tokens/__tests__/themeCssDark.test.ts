/**
 * The dark half of the emitted theme (`docs/design/uiOverhaul/darkTheme.md` §6): the roles stay in `@theme` with their
 * light values, and ONE `prefers-color-scheme: dark` block, after it, overrides the same custom properties from
 * `roleDark`, the cover tints, the glass edges and the canvas wash. `color-scheme: light dark` lets native form
 * controls and scrollbars follow. Nothing else switches the theme.
 */
import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../colors.js';
import { COVER_TINT_NAMES, coverTint, coverTintDark } from '../covers.js';
import { glass, glassEdgeDark, gradientCss, heroDark } from '../gradients.js';
import { kebab } from '../emit.js';
import { themeCss } from '../themeCss.js';
import { difficultyTone, difficultyToneDark, proTone } from '../tones.js';

const css = themeCss();

/** The text of the dark block. */
function darkBlock(): string {
    const start = css.indexOf('@media (prefers-color-scheme: dark)');

    expect(start, 'no dark block').toBeGreaterThan(-1);

    return css.slice(start, css.indexOf('\n}\n', start) + 3);
}

describe('themeCss — the dark block', () => {
    it('keeps the roles in @theme (not @theme inline), so a utility reads the variable', () => {
        expect(css).toContain('@theme {');
        expect(css).not.toContain('@theme inline');
    });

    it('comes after the @theme block', () => {
        expect(css.indexOf('@media (prefers-color-scheme: dark)')).toBeGreaterThan(css.indexOf('@theme {'));
    });

    it('overrides every role with its dark value', () => {
        const block = darkBlock();

        for (const [name, value] of Object.entries(roleDark)) {
            expect(block, name).toContain(`--color-${kebab(name)}: ${value};`);
        }
    });

    it('declares the cover tints in @theme (light) and overrides them in the dark block', () => {
        for (const name of COVER_TINT_NAMES) {
            expect(css).toContain(`--color-cover-${name}: ${coverTint[name]};`);
            expect(darkBlock()).toContain(`--color-cover-${name}: ${coverTintDark[name]};`);
        }
    });

    it('overrides the glass edges and the canvas wash', () => {
        for (const tier of Object.keys(glass)) {
            expect(darkBlock()).toContain(`--color-glass-${tier}-edge: ${glassEdgeDark};`);
        }

        expect(darkBlock()).toContain(`--background-image-hero: ${gradientCss(heroDark)};`);
    });

    // Slice 4 (`buildSpec.md` §1.4 "Difficulty"; `darkTheme.md` §2): the difficulty badge's tint and its word re-theme,
    // so a web card can draw them from a role-like variable instead of a palette class.
    it('declares the difficulty pairs in @theme (light) and overrides them in the dark block', () => {
        for (const level of ['easy', 'medium', 'hard'] as const) {
            expect(css).toContain(`--color-difficulty-${level}-fill: ${difficultyTone[level].fill};`);
            expect(css).toContain(`--color-difficulty-${level}-ink: ${difficultyTone[level].text};`);
            expect(darkBlock()).toContain(`--color-difficulty-${level}-fill: ${difficultyToneDark[level].fill};`);
            expect(darkBlock()).toContain(`--color-difficulty-${level}-ink: ${difficultyToneDark[level].text};`);
        }
    });

    it('emits the PRO pair once, in @theme, and never re-themes it (darkTheme.md §2: fixed in both themes)', () => {
        expect(css).toContain(`--color-pro-fill: ${proTone.fill};`);
        expect(css).toContain(`--color-pro-ink: ${proTone.text};`);
        expect(darkBlock()).not.toContain('--color-pro-');
    });

    it('lets native form controls follow the theme', () => {
        expect(css).toContain('color-scheme: light dark;');
    });

    it('overrides nothing in the light emission: each role keeps its light value in @theme', () => {
        expect(css).toContain(`--color-paper: ${role.paper};`);
    });
});
