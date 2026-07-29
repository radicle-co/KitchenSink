/**
 * Token invariants for the design-system colors. The chart palette must give each nutrition series a
 * DISTINCT hue (B25a) — two identical colors render as one indistinguishable series.
 *
 * ## The filled-accent contrast contract (#113)
 *
 * Everything below the chart block exists because the palette shipped tiers on which **NEITHER** a white nor a
 * dark label reached the WCAG 2.1 AA 4.5:1 floor, and the defect was invisible from any single call site: each
 * `bg-seafoam text-white` looked like a local styling choice, so ~50 of them accumulated. `seafoam` measured
 * 4.02:1 under white and 3.16:1 under charcoal — a fill with NO legible label — and `error` measured 3.16:1
 * under white and 4.02:1 under charcoal, the same trap in the other direction.
 *
 * The contract is asserted at the TOKEN, where the knowledge belongs:
 *
 *  1. every opaque accent the product fills with, paired with the label it actually carries, clears 4.5:1; and
 *  2. no accent is a TRAP — at least one of white/charcoal clears 4.5:1 on it, so a call site always HAS a
 *     legible choice. (1) alone would let a re-theme reintroduce an unlabelable fill for as long as no
 *     component happened to use it yet.
 *
 * Hue is pinned alongside the ratios: the fix for a failing tier is to move its LIGHTNESS, never to re-hue the
 * brand, and the hue assertion is what makes "seafoam was darkened" distinguishable from "seafoam was
 * replaced" — a green button that passes AA is still a regression.
 *
 * `culori` supplies the luminance math — the same library `@commise/test-utils/contrast` wraps. That module
 * cannot be imported here: it depends on `@commise/ui`, so consuming it would close a workspace cycle.
 */
import { converter, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { chart, palette, tint } from '../colors.js';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

/** WCAG 2.1 AA, SC 1.4.3 — normal-size text. Every label measured here is body-size or smaller. */
const AA_NORMAL_TEXT = 4.5;

describe('chart tokens', () => {
    it('assigns a distinct hue to every nutrition series', () => {
        const hues = Object.values(chart);

        expect(new Set(hues).size).toBe(hues.length);
    });

    it('keeps calories and protein visually distinct (the B25a collision)', () => {
        expect(chart.calories).not.toBe(chart.protein);
    });
});

/** A pairing of an opaque accent FILL with the label token painted on it. */
interface FilledAccent {
    readonly fill: keyof typeof palette;
    readonly label: keyof typeof palette;
}

/**
 * Every OPAQUE accent the product paints as a FILL beneath a label, with the label that fill actually carries
 * on both platforms. Transcribed from the real call sites, not from taste — the per-component contrast tests
 * are what keep each site pointed at the pairing named here.
 */
const FILLED_ACCENTS: readonly FilledAccent[] = [
    // Teal CTAs: the primary button, the FAB, selected chips/tabs, step markers, the avatar disc.
    { fill: 'seafoam', label: 'white' },
    // The hover/pressed end of the same CTA, and the dark stop of the primary gradient.
    { fill: 'ocean-dark', label: 'white' },
    // Destructive buttons, the wizard's invalid step, failed-upload badges.
    { fill: 'error', label: 'white' },
    // Photo-overlay chrome.
    { fill: 'charcoal', label: 'white' },
    // Light/pastel fills. A white label on any of these is FAR below the floor (1.88:1 on warning), so they
    // take a dark label instead — darkening them enough to carry white would cost the tone its identity.
    { fill: 'success', label: 'charcoal' },
    { fill: 'warning', label: 'charcoal' },
    { fill: 'premium', label: 'charcoal' },
    { fill: 'coral', label: 'charcoal' },
];

/** The tiers a fill may legitimately be drawn from — the set rule (2) polices. */
const ACCENT_TIERS = [
    'seafoam',
    'seafoam-light',
    'ocean-dark',
    'coral',
    'sky',
    'success',
    'warning',
    'error',
    'premium',
    'charcoal',
    'slate',
] as const satisfies readonly (keyof typeof palette)[];

/**
 * The brand hue of every accent, in OKLCH degrees, as originally shipped. A contrast fix adjusts LIGHTNESS;
 * re-hueing is a brand change rather than an accessibility one, so it must not pass silently.
 */
const BRAND_HUE: Readonly<Record<(typeof ACCENT_TIERS)[number], number>> = {
    seafoam: 188.5,
    'seafoam-light': 186.8,
    'ocean-dark': 186.9,
    coral: 35.6,
    sky: 228.7,
    success: 158.2,
    warning: 75.3,
    error: 34.6,
    premium: 67.1,
    charcoal: 216.8,
    slate: 221.6,
};

/** How far a tier's hue may sit from its brand hue. 3° is below a just-noticeable shift at these chromas. */
const HUE_TOLERANCE_DEGREES = 3;

describe('filled-accent label contrast (WCAG 2.1 AA, SC 1.4.3)', () => {
    it.each(FILLED_ACCENTS)('$label on a filled $fill clears the 4.5:1 body floor', ({ fill, label }) => {
        expect(wcagContrast(palette[label], palette[fill])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it.each(ACCENT_TIERS)('%s is labelable — white or charcoal clears 4.5:1 on it', (tier) => {
        const best = Math.max(
            wcagContrast(palette.white, palette[tier]),
            wcagContrast(palette.charcoal, palette[tier]),
        );

        expect(best, `no legible label exists for a filled ${tier}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it.each(ACCENT_TIERS)('%s keeps its brand hue', (tier) => {
        const hue = toOklch(palette[tier])?.h ?? Number.NaN;

        expect(Math.abs(hue - BRAND_HUE[tier])).toBeLessThanOrEqual(HUE_TOLERANCE_DEGREES);
    });
});

describe('accent-as-text contrast (WCAG 2.1 AA, SC 1.4.3)', () => {
    // `error` is not only a fill: it is the colour of alert copy, field-validation messages and the flat
    // destructive button's label, over `white` cards and the `sand` app background alike. It read 3.16:1 in
    // that role, so ONE token was failing in both directions at once — which is why the fix is the token and
    // not a per-site label swap.
    it.each(['white', 'sand', 'pearl'] as const)('error reads as text on %s', (surface) => {
        expect(wcagContrast(palette.error, palette[surface])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // The tint rule the palette JSDoc states, kept measured: a label on a 10%-alpha seafoam chip takes
    // `ocean-dark`. Darkening `seafoam` darkens that tint too, which is exactly how moving one token can push
    // an already-PASSING pair back under the floor.
    it('ocean-dark reads on a 10%-alpha seafoam tint over white', () => {
        expect(wcagContrast(palette['ocean-dark'], overWhite(tint(palette.seafoam, 0.1)))).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT,
        );
    });
});

describe('tint', () => {
    it('spells a palette colour at an alpha in the notation React Native and jsdom both use', () => {
        expect(tint(palette.coral, 0.1)).toBe('rgba(232, 145, 122, 0.1)');
    });

    it('derives from the token, so re-theming a tier moves its tint with it', () => {
        const rgb = toRgb(palette.seafoam);

        expect(tint(palette.seafoam, 0.12)).toBe(
            `rgba(${Math.round((rgb?.r ?? 0) * 255)}, ${Math.round((rgb?.g ?? 0) * 255)}, ${Math.round(
                (rgb?.b ?? 0) * 255,
            )}, 0.12)`,
        );
    });

    it('rejects a colour it cannot resolve to channels, rather than emitting a broken rgba()', () => {
        expect(() => tint('not-a-colour', 0.1)).toThrow(/tint/i);
    });

    it('rejects an alpha outside 0..1 — a percentage passed by mistake paints an opaque fill', () => {
        expect(() => tint(palette.seafoam, 10)).toThrow(/alpha/i);
    });
});

/** Flatten a translucent `rgba(...)` onto white, as the `rgb(...)` a reader sees. Pure. */
function overWhite(color: string): string {
    const rgb = toRgb(color);

    if (rgb === undefined) {
        throw new Error(`Expected a parsable colour, received "${color}".`);
    }

    const alpha = rgb.alpha ?? 1;
    const channel = (value: number): number => Math.round((value * alpha + (1 - alpha)) * 255);

    return `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})`;
}
