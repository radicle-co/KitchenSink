import { borderSubtle } from './scale.js';

/**
 * The brand palette.
 *
 * ## Two rules govern every colour here, and both are MEASURED (WCAG 2.1 AA), not a matter of taste
 *
 * State them once; do not re-derive them per component. `@commise/test-utils` makes both assertable —
 * `utilityContrast` (web class lists) and `computedContrast` (native leaves) measure the ratio a reader
 * actually experiences, alpha-composited — and `__tests__/colors.test.ts` pins them at the token.
 *
 * ### 1. A FILLED accent carries a specific label, and the two are chosen together
 *
 * The tiers split into two families, by lightness:
 *
 *  - **Dark fills take `white`** — `seafoam` (4.67:1), `ocean-dark` (6.20:1), `error` (4.66:1), `error-dark`
 *    (5.63:1), `charcoal` (12.68:1). These are the CTA, its pressed end, the destructive action, and
 *    photo-overlay chrome.
 *  - **Light/pastel fills take `charcoal`** — `success` (4.67:1), `warning` (6.74:1), `premium` (5.70:1),
 *    `coral` (5.29:1), `sky` (7.09:1). A white label on any of them is far under the floor (`warning` is
 *    1.88:1, `coral` 2.40:1), and darkening them enough to carry white would cost each tone its identity: an
 *    amber that can hold white text is a brown.
 *
 * `seafoam` and `error` were both DARKENED to land in the first family (#113). Before that, `seafoam` measured
 * 4.02:1 under white and 3.16:1 under charcoal, and `error` 3.16:1 under white and 4.02:1 under charcoal — two
 * fills with NO legible label, so no call site could be correct. Each moved in OKLCH lightness only, at
 * constant hue and chroma (`seafoam` #3D8B85 → #31807A, ΔL 0.036; `error` #E17055 → #C05238, ΔL 0.096), so the
 * hue family is unchanged. `seafoam-light` was deliberately NOT darkened: it is the light teal of
 * `semantic.primary`, and the lightness needed to carry white text (ΔL 0.125) would collapse it into `seafoam`.
 * It is therefore an accent only, never a fill under a white label.
 *
 * ### 2. Some tokens are ACCENTS or FILLS, never text — and each has a designated text sibling
 *
 * Two tiers carry both jobs, and a single hex cannot satisfy both: a FILL is measured against the white label
 * on top of it, while TEXT is measured against the near-white surface beneath it. The two constraints pull in
 * opposite directions, so each of those tiers is a PAIR — the fill, and a darker sibling for foreground use.
 *
 *  - **`seafoam-light` as a FOREGROUND on any light surface fails SC 1.4.3** — 2.78:1 on white. So does
 *    `seafoam` on its own tints (4.10:1 on `seafoam/10`). Where a teal is the colour of text a reader must
 *    READ — a tertiary/text button, a badge label on a tinted chip, a selected tab, a step numeral — use
 *    **`ocean-dark`** (6.20:1 on white, 5.45:1 on `seafoam/10`), which keeps the control in its own hue family
 *    instead of flattening it to grey.
 *  - **`error` is the destructive FILL and nothing else** — 4.66:1 under a white label, but only 4.33:1 as
 *    text on `sand` and 3.82:1 on its own `error/10` alert tint. Where the red is the colour of text a reader
 *    must READ — validation copy, an alert banner's message, the flat destructive button's label and the icon
 *    beside it — use **`error-dark`** (5.63:1 on white, 5.23:1 on `sand`, 4.95:1 on `error/10` over white).
 *    `error-dark` is `error` moved in OKLCH lightness only, so the two are the same red.
 *  - On a DARK surface the pairing INVERTS: `seafoam` is 2.72:1 on `charcoal` and `slate` is 2.42:1, so
 *    cook-mode-style chrome over a charcoal fill takes `white` (12.68:1), `mist` (6.67:1) or `seafoam-light`
 *    (4.56:1) instead.
 *  - **`mist` is a HAIRLINE/divider tone, never a text tone.** It is 1.90:1 on white — below even the 3:1
 *    floor SC 1.4.11 sets for a meaningful graphic. Text, placeholder text, empty rating pips and labelled
 *    `role="img"` placeholders take **`slate`** (5.24:1 on white).
 *  - **An ALPHA-tinted text colour is not a text colour.** `text-slate/60` measures 2.41:1 over white — the
 *    token passes, the rendered pixel does not. A dimmed/gated label uses the opaque `slate` and leans on the
 *    surrounding affordances (`cursor-not-allowed`, a "coming soon" name) to read as inactive.
 *
 * Both accent tokens remain correct — and intended — as ACCENTS: borders, rings, fills, gradients, the FAB,
 * focus indicators, the avatar disc, a switch track, a carousel dot. Those are non-text, and each clears the
 * 3:1 SC 1.4.11 floor. So this is never a blanket find-and-replace: change a site only where the token is the
 * foreground of something a reader reads.
 */
export const palette = {
    // Darkened from #3D8B85 for #113: white-on-seafoam was 4.02:1. OKLCH lightness only (0.586 → 0.550) at
    // constant hue/chroma, so every seafoam border, ring, gradient stop and /10 tint keeps its character.
    seafoam: '#31807A',
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
    // The destructive FILL. Darkened from #E17055 in OKLCH lightness only (0.672 → 0.576) so a white label
    // clears 4.5:1 (3.16 → 4.66). This is as close to the mockups' brand red as AA allows for a filled
    // control; it is NOT a text colour — see `error-dark`.
    error: '#C05238',
    // The destructive FOREGROUND, one lightness step below `error` (0.576 → 0.531) at the same hue/chroma.
    // Text has the harder constraint of the two: it is measured against the near-white surface BENEATH it, and
    // the surfaces are `white`, `sand`, `pearl` and the `error/10` alert tint over each. The tint is what makes
    // this token necessary rather than merely tidy — the previous single-token red measured 4.36:1 on
    // `bg-error/10` over white and 4.07:1 over `sand`, so the most common error surface in the product was
    // failing while only the flat backgrounds were being checked.
    'error-dark': '#B1442B',
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

/** Matches an opaque 6-digit hex colour — the only form {@link tint} can decompose into channels. */
const OPAQUE_HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * A palette colour at an alpha, as the `rgba(r, g, b, a)` string React Native understands.
 *
 * React Native has no alpha-suffix colour syntax (the web's `bg-seafoam/10`), so a native leaf that wants a
 * tinted chip has to spell one out — and every hand-written `rgba(...)` literal is a SECOND representation of a
 * palette colour that no longer moves when the token does. This repo shipped both failure modes of that: six
 * literals frozen at the pre-#113 seafoam, and `rgba(46, 196, 182, …)` — a teal (#2EC4B6) that has never been
 * in the palette at all — filling selection chips on three mobile screens. Spelling a tint out in decimal is
 * exactly what makes such a colour unsearchable.
 *
 * The emitted spacing matches what `getComputedStyle` reports, so a native contrast test can compare a
 * rendered background against `tint(...)` directly.
 *
 * @param color - An opaque `#RRGGBB` palette colour.
 * @param alpha - The tint's alpha, 0..1.
 * @returns The colour as `rgba(r, g, b, a)`.
 * @throws Error when `color` is not an opaque hex colour — a tint of a tint has no single backdrop, so it
 *   cannot be composited or measured.
 * @throws Error when `alpha` is outside 0..1. A percentage passed by mistake (`10` for 10%) would otherwise
 *   clamp to a fully OPAQUE fill, which is both invisible in review and unmeasurable.
 */
export function tint(color: string, alpha: number): string {
    const match = OPAQUE_HEX.exec(color);

    if (match === null) {
        throw new Error(`tint expects an opaque #RRGGBB palette colour, received "${color}".`);
    }

    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        throw new Error(`tint expects an alpha in 0..1, received ${alpha}.`);
    }

    const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part as string, 16));

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export type Palette = typeof palette;
export type Semantic = typeof semantic;
export type Chart = typeof chart;
