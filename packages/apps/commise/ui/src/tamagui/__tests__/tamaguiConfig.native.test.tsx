/**
 * The built Tamagui config: `createTamagui` accepts the projections and resolves each token, theme value and font to
 * the value the design system holds, and the two settings that are one-way doors are what ADR-0080 decided. Building
 * the real config matters because Tamagui 3 throws inside `createTokens` on a key it reserves while every map test
 * stays green and `tsc` stays clean.
 */
import { describe, expect, it } from 'vitest';

import { role, roleDark, type Role } from '../../tokens/colors.js';
import { radius, spacing } from '../../tokens/scale.js';
import { tamaguiConfig } from '../tamaguiConfig.native.js';
import { tamaguiFonts } from '../tamaguiFonts.js';
import { tamaguiThemes } from '../../theme/tamaguiThemes.js';

const roleNames = Object.keys(role) as Role[];

type TokenGroup = Readonly<Record<string, { readonly val: unknown } | undefined>>;

function valOf(group: TokenGroup, key: string): unknown {
    return group[key]?.val;
}

describe('the built Tamagui config', () => {
    it('lays out by React Native’s flex rules, not CSS’s', () => {
        expect(tamaguiConfig.settings.styleCompat).toBe('react-native');
    });

    it('accepts only tokens for colour, radius and stacking, and token-first values for space and size', () => {
        expect(tamaguiConfig.settings.allowedStyleValues).toEqual({
            color: 'strict',
            radius: 'strict',
            zIndex: 'strict',
            space: 'somewhat-strict',
            size: 'somewhat-strict',
        });
    });

    it('has no colour tokens', () => {
        expect(Object.keys(tamaguiConfig.tokens.color ?? {})).toEqual([]);
    });

    it('resolves every space, size and radius token to the scale', () => {
        for (const [step, value] of Object.entries(spacing)) {
            expect(valOf(tamaguiConfig.tokens.space, step), `space ${step}`).toBe(value);
            expect(valOf(tamaguiConfig.tokens.size, step), `size ${step}`).toBe(value);
        }

        for (const [name, value] of Object.entries(radius)) {
            expect(valOf(tamaguiConfig.tokens.radius, name), `radius ${name}`).toBe(value);
        }
    });

    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('resolves every %s theme key to its projected value', (scheme, colors) => {
        const theme = tamaguiConfig.themes[scheme];

        for (const name of roleNames) {
            expect(theme[name]?.val, name).toBe(colors[name]);
        }

        for (const [key, value] of Object.entries(tamaguiThemes[scheme])) {
            expect(theme[key as keyof typeof theme]?.val, key).toBe(value);
        }
    });

    it('carries the two fonts under their registered faces', () => {
        expect(tamaguiConfig.fonts.body?.family).toBe(tamaguiFonts.body.family);
        expect(tamaguiConfig.fonts.heading?.family).toBe(tamaguiFonts.heading.family);
    });

    it('defines no media queries, because native layout reads its container class and not the window', () => {
        expect(Object.keys(tamaguiConfig.media ?? {})).toEqual([]);
    });
});
