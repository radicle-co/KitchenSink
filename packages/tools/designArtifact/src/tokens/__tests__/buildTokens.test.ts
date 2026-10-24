import { palette, role, roleDark } from '@commise/ui/colors';
import { fontFamily, fontSize, fontWeight, lineHeightRatio, radius, spacing } from '@commise/ui/scale';
import { barMaterial } from '@commise/ui/tokens/barMaterial';
import { coverTint, coverTintDark } from '@commise/ui/tokens/covers';
import { kebab } from '@commise/ui/tokens/emit';
import { shadows } from '@commise/ui/tokens/shadows';
import { proTone } from '@commise/ui/tokens/tones';
import { typeRole } from '@commise/ui/tokens/typography';
import { describe, expect, it } from 'vitest';

import { fontFaces } from '../../fonts/fontFaces.js';
import type { ArtifactColorToken } from '../artifactTokens.js';
import { buildTokens } from '../buildTokens.js';

const tokens = buildTokens();

/** The group that publishes the display ramp's sizes, which carry no weight of their own. */
const SIZE_SCALE = 'Size scale';

/** The colour token of a name, or a failure naming it. */
function colour(name: string): ArtifactColorToken {
    const found = tokens.color.tokens.find((token) => token.name === name);

    if (found === undefined) {
        throw new Error(`no colour token "${name}"`);
    }

    return found;
}

describe('buildTokens', () => {
    it('names the system and its two themes', () => {
        expect(tokens.name).toBe('Commise');
        expect(tokens.color.themes.map((theme) => theme.id)).toEqual(['light', 'dark']);
    });

    describe('colour roles', () => {
        it.each(Object.keys(role) as (keyof typeof role)[])('carries %s with its light and dark value', (key) => {
            expect(colour(kebab(key)).value).toEqual({ light: role[key], dark: roleDark[key] });
        });

        it('carries the translucent bar and the fixed PRO badge pair', () => {
            expect(colour('bar').value).toEqual({ light: barMaterial.light, dark: barMaterial.dark });
            expect(colour('pro-fill').value).toEqual({ light: proTone.fill, dark: proTone.fill });
            expect(colour('pro-ink').value).toEqual({ light: proTone.text, dark: proTone.text });
        });

        it.each(Object.entries(coverTint))('carries the %s cover tint in both themes', (key, light) => {
            expect(colour(`cover-${key}`).value).toEqual({
                light,
                dark: coverTintDark[key as keyof typeof coverTintDark],
            });
        });

        it('carries a theme-independent brand tone from the palette, as a plain string', () => {
            expect(colour('brand-seafoam').value).toBe(palette.seafoam);
            expect(colour('brand-warning-dark').value).toBe(palette['warning-dark']);
            expect(colour('brand-honey').value).toBe(palette.honey);
        });
    });

    describe('every colour token', () => {
        it('has a unique name', () => {
            const names = tokens.color.tokens.map((token) => token.name);

            expect(new Set(names).size).toBe(names.length);
        });

        it('has a usage note that says something', () => {
            for (const token of tokens.color.tokens) {
                expect(token.usage.trim().length, token.name).toBeGreaterThan(8);
            }
        });

        it('states no contrast ratio in its note: a ratio drifts the day a colour moves', () => {
            for (const token of tokens.color.tokens) {
                expect(token.usage, token.name).not.toMatch(/\d:\d|\d\.\d+:1|WCAG|SC \d/);
            }
        });
    });

    describe('scales', () => {
        it('emits the spacing steps in pixels from the scale', () => {
            expect(tokens.spacing.tokens.map((token) => [token.name, token.value])).toEqual(
                Object.entries(spacing).map(([step, px]) => [`space-${step}`, `${px}px`]),
            );
        });

        it('emits the radii in pixels from the scale', () => {
            expect(tokens.radius.tokens.map((token) => [token.name, token.value])).toEqual(
                Object.entries(radius).map(([step, px]) => [`radius-${step}`, `${px}px`]),
            );
        });

        it('emits the shadows exactly as the web theme composes them', () => {
            expect(tokens.shadow.tokens.map((token) => [token.name, token.value])).toEqual(
                Object.entries(shadows).map(([step, value]) => [`shadow-${step}`, value]),
            );
        });

        it('gives every scale token a usage note', () => {
            for (const token of [...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens]) {
                expect(token.usage.trim().length, token.name).toBeGreaterThan(5);
            }
        });
    });

    describe('type', () => {
        const styles = tokens.type.groups.filter((group) => group.name !== SIZE_SCALE).flatMap((group) => group.styles);

        it('carries the font stacks from the scale', () => {
            expect(tokens.type.families).toEqual(fontFamily);
        });

        it('carries one style per type role that has a size of its own, and none for the inherited one', () => {
            const expected = Object.entries(typeRole)
                .filter(([, spec]) => spec.size !== 'inherit')
                .map(([name]) => kebab(name));

            expect(styles.map((style) => style.name).sort()).toEqual(expected.sort());
        });

        it.each(Object.entries(typeRole).filter(([, spec]) => spec.size !== 'inherit'))(
            'states %s from the role itself',
            (name, spec) => {
                const style = styles.find((candidate) => candidate.name === kebab(name));
                const px = typeof spec.size === 'number' ? spec.size : (spec.size as { wide: number }).wide;

                expect(style?.fontSize).toBe(`${px}px`);
                expect(style?.fontWeight).toBe(fontWeight[spec.weight]);
                expect(style?.lineHeight).toBe(`${spec.lineHeight}`);
            },
        );

        it('files each style under the group of its face', () => {
            for (const group of tokens.type.groups) {
                expect(group.styles.length, group.name).toBeGreaterThan(0);
            }

            const largeTitle = tokens.type.groups.find((group) => group.styles.some((s) => s.name === 'large-title'));

            expect(largeTitle?.family).toBe('display');
        });

        describe('the size scale', () => {
            const RAMP = Object.entries(fontSize).filter(([step]) => /^(display|heading)/u.test(step));
            const group = tokens.type.groups.find((candidate) => candidate.name === SIZE_SCALE);

            it('is the display face, one step per display and heading size of the scale', () => {
                expect(group?.family).toBe('display');
                expect(group?.styles.map((style) => style.name)).toEqual(RAMP.map(([step]) => kebab(step)));
            });

            it.each(RAMP)('states %s from the scale, with the heading line height', (step, size) => {
                const style = group?.styles.find((candidate) => candidate.name === kebab(step));

                expect(style?.fontSize).toBe(`${size}px`);
                expect(style?.lineHeight).toBe(`${lineHeightRatio.heading}`);
            });

            it('takes no body or caption size, which the type roles already publish', () => {
                expect(RAMP.map(([step]) => step)).toContain('displayXl');
                expect(group?.styles.map((style) => style.name)).not.toContain('body-md');
                expect(group?.styles.map((style) => style.name)).not.toContain('caption');
            });

            it('invents no weight: each call site picks its own', () => {
                expect(group?.styles.every((style) => style.fontWeight === undefined)).toBe(true);
            });
        });

        it('lists every font registration with its published file', () => {
            expect(tokens.type.fonts).toEqual(
                fontFaces().map((face) => ({
                    family: face.family,
                    file: `fonts/${face.fileName}`,
                    weight: String(face.weight),
                    style: 'normal',
                })),
            );
        });
    });
});
