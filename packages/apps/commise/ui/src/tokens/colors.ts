import { borderSubtle } from './scale.js';

/**
 * The brand palette.
 *
 * **Two tokens here are ACCENTS, not text colours, and the distinction is measured (WCAG 2.1 AA), not a
 * matter of taste. State it once; do not re-derive it per component.**
 *
 *  - **`seafoam` (and `seafoam-light`) as a FOREGROUND on any light surface fails SC 1.4.3.** Seafoam is
 *    4.02:1 on white and 3.57:1 on its own `/10` tint; `seafoam-light` is 2.78:1 on white. Body text needs
 *    4.5:1. Where seafoam is the colour of text a reader must READ — a tertiary/text button, a badge label, a
 *    selected tab, a step numeral — use **`ocean-dark`** (6.20:1 on white, 5.50:1 on `seafoam/10`), which
 *    keeps the control in its own hue family instead of flattening it to grey.
 *  - **`mist` is a HAIRLINE/divider tone, never a text tone.** It is 1.90:1 on white — below even the 3:1
 *    floor SC 1.4.11 sets for a meaningful graphic. Text, placeholder text, empty rating pips and labelled
 *    `role="img"` placeholders take **`slate`** (5.24:1 on white).
 *
 * Both tokens remain correct — and intended — as ACCENTS: borders, rings, fills, gradients, the FAB, focus
 * indicators, the avatar disc, a switch track, a carousel dot. Those are non-text, and seafoam clears the
 * 3:1 SC 1.4.11 floor. So this is never a blanket find-and-replace: change a site only where the token is the
 * foreground of something a reader reads.
 *
 * `@commise/test-utils` makes both rules assertable — `utilityContrast` (web class lists) and
 * `computedContrast` (native leaves) measure the ratio a reader actually experiences, alpha-composited.
 */
export const palette = {
    seafoam: '#3D8B85',
    'seafoam-light': '#5BA8A0',
    coral: '#E8917A',
    sky: '#8ECAE6',
    sand: '#FAF6F0',
    'ocean-dark': '#2A6B65',
    charcoal: '#2D3436',
    slate: '#636E72',
    mist: '#B2BEC3',
    pearl: '#F5F5F5',
    white: '#FFFFFF',
    success: '#4CAF7C',
    warning: '#F5B041',
    error: '#E17055',
    premium: '#D4A574',
} as const;

export const semantic = {
    background: palette.sand,
    foreground: palette.charcoal,
    card: palette.white,
    primary: palette['seafoam-light'],
    secondary: palette.coral,
    muted: palette.pearl,
    accent: palette.sky,
    destructive: palette.error,
    border: borderSubtle,
    ring: palette['seafoam-light'],
} as const;

// Each nutrition series gets a DISTINCT hue (B25a): calories + protein were byte-identical
// (`seafoam-light`), which renders two indistinguishable lines/bars.
export const chart = {
    calories: palette.seafoam,
    protein: palette.warning,
    carbs: palette.sky,
    fat: palette.coral,
    fiber: palette.success,
} as const;

export type Palette = typeof palette;
export type Semantic = typeof semantic;
export type Chart = typeof chart;
