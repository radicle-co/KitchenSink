/**
 * The contrast register of the redesign palette, in both themes: every pair the product paints is DECLARED here once
 * and MEASURED from the token values (WCAG 2.2 AA: 4.5:1 for text, SC 1.4.3; 3:1 for large text, component edges and
 * graphics, SC 1.4.11). Translucent backgrounds (`attentionTint`, `photoChip`, `bar`) are composited over the surface
 * beneath them before measuring, because a ratio against the bare rgba() is not what a reader sees.
 *
 * A pair that fails is NOT retuned here: the redesign's values are the designer's. It is listed in
 * {@link KNOWN_FAILURES} with its measured ratio and asserted BOTH WAYS: an unlisted pair below its floor is red, and
 * a listed pair that starts to pass is red too, so the list can only shrink and never goes stale.
 *
 * Mutation lens: darken `inkMuted` in dark, or point `onAction` back at white, and the pair that breaks fails by name.
 */
import { describe, expect, it } from 'vitest';

import { chart, chartDark, palette, role, roleDark, tint, type Role } from '../colors.js';
import { coverTint, coverTintDark } from '../covers.js';
import { difficultyTone, difficultyToneDark, proTone, proToneDark } from '../tones.js';
import { over, ratio } from './utils/contrast.js';

const TEXT = 4.5;
const NON_TEXT = 3;

type Theme = Readonly<Record<Role, string>>;

const THEMES: readonly (readonly [string, Theme])[] = [
    ['light', role],
    ['dark', roleDark],
];

const SURFACES = ['canvas', 'paper', 'paperRaised', 'paperOverlay', 'surfaceMuted'] as const;

/** One declared pair: what is painted, on what, and the floor it must clear. */
interface Pair {
    readonly id: string;
    readonly foreground: string;
    readonly background: string;
    readonly floor: number;
}

/** Every declared pair of one theme. Pure. */
function pairsOf(name: string, theme: Theme): readonly Pair[] {
    const pair = (id: string, foreground: string, background: string, floor: number): Pair => ({
        id: `${name}: ${id}`,
        foreground,
        background,
        floor,
    });
    const pairs: Pair[] = [];

    for (const surface of SURFACES) {
        for (const text of ['ink', 'inkMuted', 'actionText', 'attention', 'dangerText'] as const) {
            pairs.push(pair(`${text} on ${surface}`, theme[text], theme[surface], TEXT));
        }

        for (const graphic of ['lineControl', 'focusRing', 'rating', 'selectedEdge', 'hereBar', 'action'] as const) {
            pairs.push(pair(`${graphic} on ${surface}`, theme[graphic], theme[surface], NON_TEXT));
        }
    }

    pairs.push(
        pair('onAction on action', theme.onAction, theme.action, TEXT),
        pair('onAction on actionPressed', theme.onAction, theme.actionPressed, TEXT),
        pair('onAction on danger', theme.onAction, theme.danger, TEXT),
        pair('actionText on selectedFill', theme.actionText, theme.selectedFill, TEXT),
        pair('ink on selectedFill', theme.ink, theme.selectedFill, TEXT),
        pair('selectedFill stands off paper', theme.selectedFill, theme.paper, 1),
        pair('inverseInk on inverse', theme.inverseInk, theme.inverse, TEXT),
        pair('inverseAction on inverse', theme.inverseAction, theme.inverse, TEXT),
    );

    for (const surface of ['paper', 'canvas'] as const) {
        const tinted = over(theme.attentionTint, theme[surface]);

        pairs.push(
            pair(`ink on attentionTint over ${surface}`, theme.ink, tinted, TEXT),
            pair(`attention on attentionTint over ${surface}`, theme.attention, tinted, TEXT),
        );
    }

    // An alert banner is the danger fill at 10% under the danger text, over the card or the page.
    for (const surface of ['paper', 'canvas'] as const) {
        pairs.push(
            pair(
                `dangerText on a 10% danger tint over ${surface}`,
                theme.dangerText,
                over(tint(theme.danger, 0.1), theme[surface]),
                TEXT,
            ),
        );
    }

    // A photo chip and the bar sit over anything, so measure over the two extremes a photo can be.
    for (const photo of ['#000000', '#FFFFFF']) {
        pairs.push(pair(`ink on photoChip over ${photo}`, theme.ink, over(theme.photoChip, photo), TEXT));
    }

    return pairs;
}

/** Chips: a fill and the label painted on it. */
function toneRows(name: string, tones: Readonly<Record<string, { fill: string; text: string }>>): readonly Pair[] {
    return Object.entries(tones).map(([key, tone]) => ({
        id: `${name}: ${key} chip label on its fill`,
        foreground: tone.text,
        background: tone.fill,
        floor: TEXT,
    }));
}

/** The PRO badge's fill must be seen on every muted surface it can sit on (SC 1.4.11), as well as its label read. */
const PRO_EDGE_ROWS: readonly Pair[] = [
    ...(
        [
            ['light', proTone, role],
            ['dark', proToneDark, roleDark],
        ] as const
    ).flatMap(([name, tone, theme]) =>
        (['canvas', 'paper', 'surfaceMuted'] as const).map((surface) => ({
            id: `${name}: the PRO fill on ${surface}`,
            foreground: tone.fill,
            background: theme[surface],
            floor: NON_TEXT,
        })),
    ),
];

const PAIRS: readonly Pair[] = [
    ...PRO_EDGE_ROWS,
    ...THEMES.flatMap(([name, theme]) => pairsOf(name, theme)),
    ...toneRows('light', { ...difficultyTone, pro: proTone }),
    ...toneRows('dark', { ...difficultyToneDark, pro: proToneDark }),
    ...Object.entries(coverTint).map(([key, fill]) => ({
        id: `light: ink on the ${key} cover tint`,
        foreground: role.ink,
        background: fill,
        floor: TEXT,
    })),
    ...Object.entries(coverTintDark).map(([key, fill]) => ({
        id: `dark: ink on the ${key} cover tint`,
        foreground: roleDark.ink,
        background: fill,
        floor: TEXT,
    })),
    // The nutrition series are graphics on `paper` (SC 1.4.11).
    ...Object.entries(chart).map(([key, colour]) => ({
        id: `light: the ${key} chart series on paper`,
        foreground: colour,
        background: role.paper,
        floor: NON_TEXT,
    })),
    ...Object.entries(chartDark).map(([key, colour]) => ({
        id: `dark: the ${key} chart series on paper`,
        foreground: colour,
        background: roleDark.paper,
        floor: NON_TEXT,
    })),
    // The white label of a destructive or pressed fill uses palette.white / snow, kept honest at the palette.
    {
        id: 'light: white on the error fill',
        foreground: palette.white,
        background: palette.error,
        floor: TEXT,
    },
];

/**
 * Pairs of the redesign's own values that sit below their floor, reported to the designer and NOT retuned here.
 * Each entry is the pair id and the ratio measured when it was recorded. EMPTY since the design session retuned the
 * danger colours and the chart series (2026-10-27); it stays so a future failure is recorded, not hidden.
 */
const KNOWN_FAILURES: Readonly<Record<string, number>> = {};

describe('the redesign palette, every declared pair', () => {
    it.each(PAIRS)('$id', ({ id, foreground, background, floor }) => {
        const measured = ratio(foreground, background);
        const known = id in KNOWN_FAILURES;

        if (known) {
            expect(measured, `${id} now passes (${measured.toFixed(2)}:1): remove it from KNOWN_FAILURES`).toBeLessThan(
                floor,
            );

            return;
        }

        expect(measured, `${id} is ${measured.toFixed(2)}:1, under ${floor}:1`).toBeGreaterThanOrEqual(floor);
    });

    it('lists no failure that is not a declared pair', () => {
        const ids = new Set(PAIRS.map((pair) => pair.id));

        for (const id of Object.keys(KNOWN_FAILURES)) {
            expect(ids.has(id), id).toBe(true);
        }
    });
});
