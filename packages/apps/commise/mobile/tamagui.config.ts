import { palette } from '@commise/ui/tokens/colors';
import { createTamagui, createTokens, createFont } from 'tamagui';

// Colour hex values have ONE authoritative source: the @commise/ui palette (shared with the web
// design tokens + Clerk theme). Tamagui keeps its camelCase token keys — required by the theme
// references below and by `$token` accessors in components — but the values are derived, never
// re-declared, so web and mobile cannot drift on a colour.
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
    space: {
        0: 0,
        1: 4,
        2: 8,
        3: 12,
        4: 16,
        5: 24,
        6: 32,
        7: 48,
        8: 64,
        9: 96,
    },
    size: {
        0: 0,
        1: 4,
        2: 8,
        3: 12,
        4: 16,
        5: 24,
        6: 32,
        7: 48,
        8: 64,
        9: 96,
    },
    radius: {
        0: 0,
        1: 6,
        2: 12,
        3: 20,
        4: 28,
        5: 9999,
    },
    zIndex: {
        0: 0,
        1: 100,
        2: 200,
    },
});

const bodyFont = createFont({
    family: 'Inter, system-ui, sans-serif',
    size: {
        1: 14,
        2: 16,
        3: 18,
        4: 18,
        5: 20,
        6: 24,
        7: 28,
        8: 36,
        9: 48,
    },
    lineHeight: {
        1: 21,
        2: 24,
        3: 27,
        4: 21.6,
        5: 24,
        6: 28.8,
        7: 33.6,
        8: 43.2,
        9: 57.6,
    },
    weight: {
        1: '400',
        2: '500',
        3: '600',
        4: '700',
    },
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
    family: '"Playfair Display", Georgia, serif',
    size: {
        1: 16,
        2: 20,
        3: 24,
        4: 28,
        5: 36,
        6: 48,
        7: 28,
        8: 36,
        9: 48,
    },
    lineHeight: {
        1: 19.2,
        2: 24,
        3: 28.8,
        4: 33.6,
        5: 43.2,
        6: 57.6,
        7: 33.6,
        8: 43.2,
        9: 57.6,
    },
    weight: {
        1: '400',
        2: '500',
        3: '600',
        4: '700',
    },
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
            borderColor: 'rgba(178, 190, 195, 0.3)',
            focusRing: tokens.color.seafoamLight,
        },
    },
});

export type AppConfig = typeof config;

declare module '@tamagui/core' {
    interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
