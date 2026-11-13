/**
 * @module @commise/ui/tamagui-config — the one Tamagui config, built from the design system's own tokens. Native only:
 * the web app styles with Tailwind and never loads Tamagui, so this module has no web sibling (the `./modal` export is
 * the precedent).
 *
 * Two settings are one-way doors (ADR-0080), and the config test pins both:
 *
 * - `styleCompat: 'react-native'` lays out by React Native's flex rules. Tamagui's default is CSS's, under which
 *   `flex: 1` also shrinks; every ported screen is laid out under this choice, so changing it re-lays them all.
 * - `allowedStyleValues` accepts only tokens for colour, radius and stacking. A hex colour, a palette swatch or an
 *   off-scale radius is a type error, not a review comment.
 *
 * One border width token, `$hairline`: the device's thinnest line, for section dividers and rules (designer ruling
 * 2026-11-01). It is React Native's own value, read here once, because it depends on the screen's pixel density and so
 * cannot live in the pure token map. A control outline stays a plain 1 pt.
 *
 * No `media`: native layout reads its container class (`layout/containerClass.ts`), not the window. Tamagui 3 adds
 * its own shorthands whatever the config says; the style guards read the long names. One animation, `sheet`; the only motion
 * the design system has, built through `motionPropsOf`.
 *
 * @pattern Registry — the single registration of tokens, themes and fonts with Tamagui
 */
import { createAnimations } from '@tamagui/animations-react-native';
import { StyleSheet } from 'react-native';
import { createFont, createTamagui, createTokens } from 'tamagui';

import { tamaguiFonts } from './tamaguiFonts.js';
import { tamaguiThemes } from '../theme/tamaguiThemes.js';
import { tamaguiTokens } from './tamaguiTokens.js';

export const tamaguiConfig = createTamagui({
    tokens: createTokens({
        ...tamaguiTokens,
        // NATIVE-STYLE-ADAPTER: the hairline is a density-dependent React Native value with no Tamagui source of its own.
        borderWidth: { hairline: StyleSheet.hairlineWidth },
    }),
    // The named springs: the check box's check (§1.9) and the Sheet. The driver runs on a device; the test lanes alias it
    // to `@commise/ui/testing/animations-shim`.
    animations: createAnimations({
        check: { type: 'spring', damping: 28, stiffness: 600 },
        sheet: { type: 'spring', damping: 24, mass: 1, stiffness: 280 },
    }),
    themes: tamaguiThemes,
    fonts: {
        body: createFont(tamaguiFonts.body),
        heading: createFont(tamaguiFonts.heading),
    },
    settings: {
        styleCompat: 'react-native',
        allowedStyleValues: {
            color: 'strict',
            radius: 'strict',
            zIndex: 'strict',
            space: 'somewhat-strict',
            size: 'somewhat-strict',
        },
    },
});

export type TamaguiAppConfig = typeof tamaguiConfig;

declare module 'tamagui' {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging is how Tamagui's types learn this config's tokens and themes
    interface TamaguiCustomConfig extends TamaguiAppConfig {}
}
