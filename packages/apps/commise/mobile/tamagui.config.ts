import { borderSubtle, fontFamily } from '@commise/ui/scale';
import { palette } from '@commise/ui/tokens/colors';
import { createTamagui, createTokens, createFont } from 'tamagui';

import {
    bodyFontSize,
    bodyLineHeight,
    displayFontSize,
    displayLineHeight,
    fontWeightRamp,
    radiusScale,
    sizeScale,
    spaceScale,
} from './src/theme/scaleTokens.js';

// Values have ONE authoritative source: the @commise/ui design scale (shared with the web design tokens).
// Colours derive from the `palette`; the space/size/radius ramps and BOTH font ramps derive from
// `@commise/ui/scale` via `./src/theme/scaleTokens` — Tamagui keeps its positional numeric keys (required
// by `$token`/`$size` accessors and the theme references below), but the numbers are derived, never
// re-declared, so web and mobile cannot drift. The drift guard is `tests/theme/scaleTokens.test.ts`.
const tokens = createTokens({
    color: {
        seafoam: palette.seafoam,
        seafoamLight: palette['seafoam-light'],
        coral: palette.coral,
        sky: palette.sky,
        sand: palette.sand,
        oceanDark: palette['ocean-dark'],
        charcoal: palette.charcoal,
        slate: palette.slate,
        mist: palette.mist,
        pearl: palette.pearl,
        white: palette.white,
        success: palette.success,
        warning: palette.warning,
        error: palette.error,
        premium: palette.premium,
    },
    space: { ...spaceScale },
    size: { ...sizeScale },
    radius: { ...radiusScale },
    zIndex: {
        0: 0,
        1: 100,
        2: 200,
    },
});

const bodyFont = createFont({
    family: fontFamily.body,
    size: { ...bodyFontSize },
    lineHeight: { ...bodyLineHeight },
    weight: { ...fontWeightRamp },
    letterSpacing: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
    },
    face: {
        400: { normal: 'Inter' },
        500: { normal: 'Inter' },
        600: { normal: 'Inter' },
        700: { normal: 'Inter' },
    },
});

const displayFont = createFont({
    family: fontFamily.display,
    size: { ...displayFontSize },
    lineHeight: { ...displayLineHeight },
    weight: { ...fontWeightRamp },
    letterSpacing: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
        6: 0,
        7: 0,
        8: 0,
        9: 0,
    },
    face: {
        400: { normal: 'PlayfairDisplay' },
        500: { normal: 'PlayfairDisplay' },
        600: { normal: 'PlayfairDisplay' },
        700: { normal: 'PlayfairDisplay' },
    },
});

const config = createTamagui({
    fonts: {
        body: bodyFont,
        heading: displayFont,
    },
    tokens,
    themes: {
        light: {
            background: tokens.color.sand,
            color: tokens.color.charcoal,
            card: tokens.color.white,
            primary: tokens.color.seafoamLight,
            secondary: tokens.color.coral,
            muted: tokens.color.pearl,
            accent: tokens.color.sky,
            destructive: tokens.color.error,
            borderColor: borderSubtle,
            focusRing: tokens.color.seafoamLight,
        },
    },
});

export type AppConfig = typeof config;

declare module '@tamagui/core' {
    interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
