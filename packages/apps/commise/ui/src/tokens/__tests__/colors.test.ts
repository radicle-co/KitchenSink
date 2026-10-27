/**
 * Token invariants for the design-system colors. The chart palette must give each nutrition series a
 * DISTINCT hue (B25a) — two identical colors render as one indistinguishable series.
 *
 * ## The filled-accent contrast contract (#113)
 *
 * Everything below the chart block exists because the palette shipped tiers on which **NEITHER** a white nor a
 * dark label reached the WCAG 2.1 AA 4.5:1 floor, and the defect was invisible from any single call site: each
 * `bg-action text-on-action` looked like a local styling choice, so ~50 of them accumulated. `steel` measured
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
 * ## Why the red is TWO tokens (`error` fills, `error-dark` writes)
 *
 * The destructive red carries two jobs with OPPOSING contrast requirements: as a FILL it must be dark enough
 * for a white label (SC 1.4.3 against white), and as TEXT it must be dark enough against near-white surfaces
 * — `white` cards, the `fog` app background, `pearl`, and its own `error/10` alert tint. The text job is
 * strictly the harder one, so one hex serving both is pinned to the text constraint and ends up darker than
 * the brand red the mockups draw. Measured: the lightest single hex satisfying both is `#BB4E34`, which is
 * 2.6% of the way from `#BA4D34` to the mockups' `#E17055` and leaves 0.03 of slack on `pearl` — i.e. one
 * token buys essentially nothing. Splitting the roles lets the FILL sit where the design wants it while the
 * FOREGROUND red is sized by measurement. The invariant that keeps the two from being swapped or merged is
 * asserted below: same hue, `error-dark` strictly darker, each clearing the floor of its own role.
 *
 * Hue is pinned alongside the ratios: the fix for a failing tier is to move its LIGHTNESS, never to re-hue the
 * brand, and the hue assertion is what makes "steel was darkened" distinguishable from "steel was
 * replaced" — a green button that passes AA is still a regression.
 *
 * `culori` supplies the luminance math — the same library `@commise/test-utils/contrast` wraps. That module
 * cannot be imported here: it depends on `@commise/ui`, so consuming it would close a workspace cycle.
 */
import { converter, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { chart, palette, role, semantic, tint } from '../colors.js';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

/** WCAG 2.1 AA, SC 1.4.3 — normal-size text. Every label measured here is body-size or smaller. */
const AA_NORMAL_TEXT = 4.5;

/** WCAG 2.2 AA, SC 1.4.11 — a component edge, a state indicator or a meaningful graphic. */
const AA_NON_TEXT = 3;

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
    // Steel CTAs: the primary button, the FAB, selected chips/tabs, step markers, the avatar disc.
    { fill: 'steel', label: 'snow' },
    // The hover/pressed end of the same CTA, and the dark stop of the primary gradient.
    { fill: 'ocean-dark', label: 'snow' },
    // Destructive buttons, the wizard's invalid step, failed-upload badges.
    { fill: 'error', label: 'snow' },
    // The FOREGROUND red is also a legal fill (the pressed end of a destructive control), same as `ocean-dark`.
    { fill: 'error-dark', label: 'snow' },
    // Photo-overlay chrome.
    { fill: 'charcoal', label: 'white' },
    // Light/pastel fills. A white label on any of these is FAR below the floor (1.88:1 on warning), so they
    // take a dark label instead — darkening them enough to carry white would cost the tone its identity.
    { fill: 'success', label: 'charcoal' },
    { fill: 'warning', label: 'charcoal' },
    { fill: 'coral', label: 'charcoal' },
];

/** The tiers a fill may legitimately be drawn from — the set rule (2) polices. */
const ACCENT_TIERS = [
    'steel',
    'steel-light',
    'ocean-dark',
    'coral',
    'sky',
    'success',
    'warning',
    'warning-dark',
    'error',
    'error-dark',
    'charcoal',
    'slate',
] as const satisfies readonly (keyof typeof palette)[];

/**
 * The brand hue of every accent, in OKLCH degrees, as originally shipped. A contrast fix adjusts LIGHTNESS;
 * re-hueing is a brand change rather than an accessibility one, so it must not pass silently.
 */
const BRAND_HUE: Readonly<Record<(typeof ACCENT_TIERS)[number], number>> = {
    // The redesign's storm-ocean blue: steel, its light and its pressed end share one hue.
    steel: 245.5,
    'steel-light': 245.7,
    'ocean-dark': 245.7,
    // Pale cream and pale blue washes (the same values as the cover tints).
    coral: 74.3,
    sky: 242.7,
    success: 158.2,
    warning: 75.3,
    'warning-dark': 72.1,
    error: 34.6,
    'error-dark': 34.3,
    // The cool neutrals lean the same blue as the steel.
    charcoal: 254.1,
    slate: 254.0,
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
    // `error-dark` is the red in FOREGROUND position: alert copy, field-validation messages, the flat
    // destructive button's label and the icon beside it. Every surface the product paints that copy on is
    // measured, INCLUDING the `error/10` alert tint the copy most often sits inside — a pairing that shipped
    // at 4.36:1 while the single-token `error` was believed to pass, because only the flat surfaces were ever
    // measured. The tint is derived from the FILL token (`bg-danger/10` is what the markup says), so a re-theme
    // of either half moves this assertion.
    it.each(['white', 'fog', 'pearl'] as const)('error-dark reads as text on %s', (surface) => {
        expect(wcagContrast(palette['error-dark'], palette[surface])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // The tint is measured over the two surfaces an alert banner sits on (`darkTheme.md` §3.2). ⚠️ Not over linen
    // (`pearl`, D11): there it is 4.30:1, so an error banner never sits on a muted surface (raised with the designer).
    // The tint is measured over the two surfaces an alert banner sits on. (`error-dark` was retuned to #A53E27 by the
    // design session so the banner clears 4.5:1 over the cool canvas too; the old #B1442B measured 4.45:1 there.)
    it.each(['white', 'fog'] as const)('error-dark reads as text on a 10%-alpha error tint over %s', (surface) => {
        expect(
            wcagContrast(palette['error-dark'], over(tint(palette.error, 0.1), palette[surface])),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // `warning-dark` is the amber in FOREGROUND position: the "why this is disabled" note under a visibility
    // toggle, a parse row's caution status, a picker's terminal notice. `warning` itself is 1.88:1 on white —
    // far under the floor, and under even the 3:1 SC 1.4.11 graphic floor — so it is a FILL only.
    //
    // ⛔ There is deliberately NO `warning/10`-tint assertion here, and its absence is not the omission
    // `error-dark`'s block above exists to prevent. Every warning-tinted surface in the product carries
    // `text-ink`; the amber is never painted on its own tint, so that pairing has no call site to measure.
    // The red's case is the opposite — its alert copy sits INSIDE the `error/10` banner — which is why the tint
    // is asserted there and not here.
    it.each(['white', 'fog', 'pearl'] as const)('warning-dark reads as text on %s', (surface) => {
        expect(wcagContrast(palette['warning-dark'], palette[surface])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // The same anti-swap invariant the reds carry: one hue, lightness apart, foreground darker. Without it a
    // re-theme could swap them — every ratio above would still pass while every `bg-warning` chip lost its
    // charcoal label and every `text-attention` note went light — or collapse them back into one token.
    it('warning-dark is the same amber as warning, strictly darker', () => {
        const fill = toOklch(palette.warning);
        const foreground = toOklch(palette['warning-dark']);

        // 4°, not the 3° the reds hold: `darkTheme.md` §1's #8C5A00 sits 3.2° warmer than the fill. Still one amber.
        expect(Math.abs((foreground?.h ?? Number.NaN) - (fill?.h ?? Number.NaN))).toBeLessThanOrEqual(4);
        expect(foreground?.l).toBeLessThan(fill?.l ?? 0);
    });

    // The two reds must stay ONE hue apart in LIGHTNESS only, with the foreground one darker. Without this a
    // re-theme could swap them (every ratio above would still pass, while every `bg-danger` fill lost its white
    // label and every `text-danger-text` label went light), or collapse them back to one token.
    it('error-dark is the same red as error, strictly darker', () => {
        const fill = toOklch(palette.error);
        const foreground = toOklch(palette['error-dark']);

        expect(Math.abs((foreground?.h ?? Number.NaN) - (fill?.h ?? Number.NaN))).toBeLessThanOrEqual(
            HUE_TOLERANCE_DEGREES,
        );
        expect(foreground?.l).toBeLessThan(fill?.l ?? 0);
    });

    // The tint rule the palette JSDoc states, kept measured: a label on a 10%-alpha steel chip takes
    // `ocean-dark`. Darkening `steel` darkens that tint too, which is exactly how moving one token can push
    // an already-PASSING pair back under the floor.
    it('ocean-dark reads on a 10%-alpha steel tint over white', () => {
        expect(
            wcagContrast(palette['ocean-dark'], over(tint(palette.steel, 0.1), palette.white)),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
});

/**
 * The overhaul's colour ROLES (`docs/design/uiOverhaul/buildSpec.md` §1.4). A screen names a role, never a palette
 * tier, so the measured contract lives here once: every pairing the spec's contrast column states is recomputed from
 * the tokens, on the surfaces the role is actually painted on (`paper` = white, `canvas` = fog).
 *
 * Mutation lens: point a role at a neighbouring tier (`inkMuted` → `mist`, `lineControl` → `mist`, `rating` →
 * `warning`) and its row fails; re-spell `selectedFill` by hand and the recomputation fails; repurpose a legacy
 * `semantic` key instead of adding a role and the "never changes an existing key" row fails.
 */
describe('colour roles (§1.4)', () => {
    // REWRITTEN for the redesign (exact values are pinned to the design sources in `redesignPin.test.ts`): the amber
    // star (`honey`) and the PRO tan (`premium`) are gone, because each became a copy of another entry.
    it('has dropped the amber star and the PRO tan, which the redesign made copies of charcoal and slate', () => {
        expect(Object.keys(palette)).not.toContain('honey');
        expect(Object.keys(palette)).not.toContain('premium');
        expect(role.rating).toBe(palette.charcoal);
    });

    it('draws every role but the four derived fills from a palette entry', () => {
        const paletteValues = new Set<string>(Object.values(palette));
        const derived = new Set<keyof typeof role>(['selectedFill', 'attentionTint', 'photoChip', 'scrim']);

        for (const [name, value] of Object.entries(role)) {
            if (!derived.has(name as keyof typeof role)) {
                expect(paletteValues.has(value), `${name} is not a palette entry`).toBe(true);
            }
        }
    });

    it('names each role after the tier the spec assigns it', () => {
        expect(role).toMatchObject({
            canvas: palette.fog,
            paper: palette.white,
            ink: palette.charcoal,
            inkMuted: palette.slate,
            lineControl: palette.pewter,
            lineDivider: palette.mist,
            action: palette.steel,
            actionText: palette.steel,
            selectedEdge: palette.steel,
            hereBar: palette.steel,
            focusRing: palette.steel,
            rating: palette.charcoal,
            attention: palette['warning-dark'],
            danger: palette.error,
            dangerText: palette['error-dark'],
        });
    });

    // REWRITTEN for the redesign: `selectedFill` is the designer's literal (#E4EEF7), no longer 14% of the action composited
    // over white. What is held is its meaning: a pale wash of the steel's own hue, lighter than the steel-light accent.
    it('keeps selectedFill a pale wash in the steel hue', () => {
        const fill = toOklch(role.selectedFill);
        const steel = toOklch(palette.steel);

        expect(Math.abs((fill?.h ?? Number.NaN) - (steel?.h ?? Number.NaN))).toBeLessThanOrEqual(10);
        expect(fill?.l ?? 0).toBeGreaterThan(toOklch(palette['steel-light'])?.l ?? 1);
    });

    it('derives attentionTint from the warning fill at 20%', () => {
        expect(role.attentionTint).toBe(tint(palette.warning, 0.2));
    });

    // REWRITTEN for the redesign: the legacy semantic names now FOLLOW the roles (they used to point at palette tiers of
    // their own: `secondary` was coral, `ring` was the light teal), so a utility in either vocabulary paints one colour.
    // Both themes are pinned in `redesignPin.test.ts`.
    it('makes the legacy semantic keys follow the roles', () => {
        expect(semantic.secondary).toBe(role.surfaceMuted);
        expect(semantic.ring).toBe(role.focusRing);
    });

    describe('text roles clear 4.5:1 (SC 1.4.3)', () => {
        it.each([
            ['ink', 'paper'],
            ['ink', 'canvas'],
            ['inkMuted', 'paper'],
            ['inkMuted', 'canvas'],
            ['actionText', 'paper'],
            ['actionText', 'canvas'],
            ['actionText', 'selectedFill'],
            ['dangerText', 'paper'],
            ['dangerText', 'canvas'],
            ['attention', 'paper'],
            ['attention', 'canvas'],
        ] as const)('%s on %s', (text, surface) => {
            expect(wcagContrast(role[text], role[surface])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });

        it.each([
            ['paper', 'action'],
            ['paper', 'danger'],
        ] as const)('a %s label on a filled %s', (label, fill) => {
            expect(wcagContrast(role[label], role[fill])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        });

        // ⚠️ MEASURED SPEC GAP, recorded rather than tuned (flagged to `staff-ux-engineer`): §1.4 pairs `attention`
        // text with a 20% `warning` tint, and that pair is 4.497:1 over paper and 4.24:1 over the canvas — under the
        // floor on both. So the tint carries `ink`, which is what the shipped caution badge already does.
        it.each(['paper', 'canvas'] as const)('the attention tint takes an ink label over %s', (surface) => {
            expect(wcagContrast(role.ink, over(role.attentionTint, role[surface]))).toBeGreaterThanOrEqual(
                AA_NORMAL_TEXT,
            );
        });

        // REWRITTEN in slice 2: attention on its own tint no longer fails. `darkTheme.md` §1's #8C5A00 lifts it to
        // 5.18:1 over paper and 4.88:1 over the canvas; the pair is measured in both themes in `themeRoles.test.ts`.
    });

    describe('edge, state and graphic roles clear 3:1 (SC 1.4.11)', () => {
        it.each([
            ['lineControl', 'paper'],
            ['lineControl', 'canvas'],
            ['selectedEdge', 'paper'],
            ['hereBar', 'paper'],
            ['hereBar', 'canvas'],
            ['focusRing', 'paper'],
            ['focusRing', 'canvas'],
            ['rating', 'paper'],
        ] as const)('%s on %s', (graphic, surface) => {
            expect(wcagContrast(role[graphic], role[surface])).toBeGreaterThanOrEqual(AA_NON_TEXT);
        });
    });

    // REWRITTEN for the redesign: stars are ink, never an amber, so `rating` now clears the text floor on paper. It is
    // still never TEXT (the number beside the stars is `ink`); the redesign simply stopped needing the in-between tone.
    it('rating is ink: the stars are the colour of the text', () => {
        expect(role.rating).toBe(role.ink);
        expect(wcagContrast(role.rating, role.paper)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('lineDivider stays a hairline — it never clears the 3:1 a component edge needs', () => {
        expect(wcagContrast(role.lineDivider, role.paper)).toBeLessThan(AA_NON_TEXT);
    });
});

describe('tint', () => {
    it('spells a palette colour at an alpha in the notation React Native and jsdom both use', () => {
        expect(tint(palette.coral, 0.1)).toBe('rgba(247, 233, 215, 0.1)');
    });

    it('derives from the token, so re-theming a tier moves its tint with it', () => {
        const rgb = toRgb(palette.steel);

        expect(tint(palette.steel, 0.12)).toBe(
            `rgba(${Math.round((rgb?.r ?? 0) * 255)}, ${Math.round((rgb?.g ?? 0) * 255)}, ${Math.round(
                (rgb?.b ?? 0) * 255,
            )}, 0.12)`,
        );
    });

    it('rejects a colour it cannot resolve to channels, rather than emitting a broken rgba()', () => {
        expect(() => tint('not-a-colour', 0.1)).toThrow(/tint/i);
    });

    it('rejects an alpha outside 0..1 — a percentage passed by mistake paints an opaque fill', () => {
        expect(() => tint(palette.steel, 10)).toThrow(/alpha/i);
    });
});

/** Flatten a translucent `rgba(...)` onto an opaque backdrop, as the `rgb(...)` a reader sees. Pure. */
function over(color: string, backdrop: string): string {
    const rgb = toRgb(color);
    const beneath = toRgb(backdrop);

    if (rgb === undefined || beneath === undefined) {
        throw new Error(`Expected parsable colours, received "${color}" over "${backdrop}".`);
    }

    const alpha = rgb.alpha ?? 1;
    const channel = (value: number, under: number): number => Math.round((value * alpha + under * (1 - alpha)) * 255);

    return `rgb(${channel(rgb.r, beneath.r)}, ${channel(rgb.g, beneath.g)}, ${channel(rgb.b, beneath.b)})`;
}
