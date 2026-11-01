/**
 * The built Tamagui config: `createTamagui` accepts the projections and resolves each token, theme value and font to
 * the value the design system holds, and the two settings that are one-way doors are what ADR-0080 decided. Building
 * the real config matters because Tamagui 3 throws inside `createTokens` on a key it reserves while every map test
 * stays green and `tsc` stays clean.
 */
import { StyleSheet } from 'react-native';
import { createTamagui, createTokens } from 'tamagui';
import { describe, expect, it } from 'vitest';

import { role, roleDark, type Role } from '../../tokens/colors.js';
import { radius, spacing } from '../../tokens/scale.js';
import { tamaguiFonts } from '../tamaguiFonts.js';
import { tamaguiThemes } from '../../theme/tamaguiThemes.js';

// Tamagui's built-in shorthand table, read from a config built BEFORE ours: `createTamagui` keeps global state, so a
// config built after ours would carry our shorthands too, and the comparison below would compare a table with itself.
const builtInShorthands = Object.keys(
    createTamagui({
        tokens: createTokens({ space: {}, size: {}, radius: {}, zIndex: {}, color: {} }),
        themes: {},
        fonts: {},
    }).shorthands,
).sort((a, b) => a.localeCompare(b));

const { tamaguiConfig } = await import('../tamaguiConfig.native.js');

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

    // Designer ruling 2026-11-01 (nativeBoards/designAnswers.md): a section divider or a rule is a hairline, the
    // device's thinnest line, and a control outline stays 1 pt. Tamagui reads every border width from this one group.
    it('has one border width token, the hairline, at React Native’s hairline width', () => {
        expect(Object.keys(tamaguiConfig.tokens.borderWidth ?? {})).toEqual(['hairline']);
        expect(valOf(tamaguiConfig.tokens.borderWidth ?? {}, 'hairline')).toBe(StyleSheet.hairlineWidth);
    });

    it('carries the two fonts under their registered faces', () => {
        expect(tamaguiConfig.fonts.body?.family).toBe(tamaguiFonts.body.family);
        expect(tamaguiConfig.fonts.heading?.family).toBe(tamaguiFonts.heading.family);
    });

    it('adds no shorthand of its own beyond Tamagui’s built-in table, which is the one table the G7 guard reads', () => {
        expect(Object.keys(tamaguiConfig.shorthands).sort((a, b) => a.localeCompare(b))).toEqual(builtInShorthands);
    });

    it('defines no media queries, because native layout reads its container class and not the window', () => {
        expect(Object.keys(tamaguiConfig.media ?? {})).toEqual([]);
    });
});
