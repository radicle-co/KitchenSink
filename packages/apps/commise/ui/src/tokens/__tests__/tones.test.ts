/**
 * The difficulty and status tones (`docs/design/uiOverhaul/buildSpec.md` §1.4, "Difficulty" and "Status").
 *
 * Each tone is a fill and the label painted on it, chosen together, so the contract is the PAIR's ratio on the
 * surfaces a badge sits on: a card (`paper`) and the bare page (`canvas`). The difficulty fills are translucent tints,
 * so each one is composited over both before it is measured, the way a reader sees it.
 *
 * Mutation lens: swap Easy's label to `inkMuted`, point Hard at the `error` red, give a status tone the amber, or drop
 * a status icon, and a row below fails.
 */
import { wcagContrast, converter } from 'culori';
import { describe, expect, it } from 'vitest';

import { palette, role, roleDark, tint } from '../colors.js';
import { difficultyTone, difficultyToneDark, proTone, proToneDark, statusTone, statusToneDark } from '../tones.js';

const toRgb = converter('rgb');

/** WCAG 2.1 AA, SC 1.4.3 — a badge label is caption-sized text. */
const AA_NORMAL_TEXT = 4.5;

describe('difficultyTone', () => {
    it('is keyed by exactly the three difficulties', () => {
        expect(Object.keys(difficultyTone).sort()).toEqual(['easy', 'hard', 'medium']);
    });

    // REWRITTEN for the redesign: a difficulty chip has no hue. Every level is the neutral surfaceMuted under ink and the
    // three-dot meter tells them apart (it used to be three tints: success, warning, coral).
    it('is the neutral surfaceMuted under ink for every level', () => {
        expect(difficultyTone).toEqual({
            easy: { fill: role.surfaceMuted, text: role.ink },
            medium: { fill: role.surfaceMuted, text: role.ink },
            hard: { fill: role.surfaceMuted, text: role.ink },
        });
    });

    it.each(['easy', 'medium', 'hard'] as const)('%s reads on its tint over paper', (level) => {
        const { fill, text } = difficultyTone[level];

        expect(wcagContrast(text, over(fill, role.paper))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it.each(['easy', 'hard'] as const)('%s also reads on its tint over the canvas', (level) => {
        const { fill, text } = difficultyTone[level];

        expect(wcagContrast(text, over(fill, role.canvas))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // REWRITTEN in slice 2: the gap this pinned (Medium 4.37:1 over the canvas) is closed by `darkTheme.md` §1's
    // `attention` #8C5A00 (5.00:1), so the difficulty badge may sit on the canvas as well as on paper.
    it('medium also clears the floor over the canvas', () => {
        const { fill, text } = difficultyTone.medium;

        expect(wcagContrast(text, over(fill, role.canvas))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // §1.4: "`error` is never used for difficulty". Hard is coral, and coral is not the destructive red.
    it('never uses the error reds, as a fill or as a label', () => {
        const reds = [palette.error, palette['error-dark']];

        for (const { fill, text } of Object.values(difficultyTone)) {
            expect(reds).not.toContain(text);
            expect(reds.map((red) => tint(red, 0.15))).not.toContain(fill);
        }
    });

    // REWRITTEN for the redesign: the three fills are ONE neutral on purpose (the three-dot meter tells them apart, SC
    // 1.4.1). It used to assert three distinct fills.
    it('shares one neutral fill across the levels, since the meter carries the difference', () => {
        expect(new Set(Object.values(difficultyTone).map((tone) => tone.fill)).size).toBe(1);
    });
});

describe('statusTone', () => {
    it('is keyed by exactly the three statuses', () => {
        expect(Object.keys(statusTone).sort()).toEqual(['draft', 'private', 'public']);
    });

    // §1.4: neutral — `pearl` fill, `ink` text, never amber — told apart by the icon, not by colour (SC 1.4.1).
    it('is neutral for every status, and the icon tells them apart', () => {
        expect(statusTone).toEqual({
            draft: { fill: palette.pearl, text: role.ink, icon: 'pencilLine' },
            private: { fill: palette.pearl, text: role.ink, icon: 'lock' },
            public: { fill: palette.pearl, text: role.ink, icon: 'globe' },
        });
    });

    it('never paints a status amber', () => {
        for (const { fill, text } of Object.values(statusTone)) {
            expect([fill, text]).not.toContain(palette.warning);
            expect([fill, text]).not.toContain(palette['warning-dark']);
        }
    });

    it.each(['draft', 'private', 'public'] as const)('%s reads on its fill', (status) => {
        const { fill, text } = statusTone[status];

        expect(wcagContrast(text, fill)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
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

/**
 * The dark tones (`docs/design/uiOverhaul/darkTheme.md` §2): the difficulty fills at 18% (15% in light), labelled in
 * the dark text roles, and the status tones on the dark `surfaceMuted`. Measured over dark paper and the dark canvas.
 */
describe('the dark tones', () => {
    // REWRITTEN for the redesign: the dark levels are the neutral dark surfaceMuted under dark ink too.
    it('uses the neutral dark pair for every level', () => {
        expect(difficultyToneDark).toEqual({
            easy: { fill: roleDark.surfaceMuted, text: roleDark.ink },
            medium: { fill: roleDark.surfaceMuted, text: roleDark.ink },
            hard: { fill: roleDark.surfaceMuted, text: roleDark.ink },
        });
        expect(statusToneDark.draft).toEqual({ fill: roleDark.surfaceMuted, text: roleDark.ink, icon: 'pencilLine' });
    });

    it.each(['easy', 'medium', 'hard'] as const)(
        '%s reads on its tint over dark paper and the dark canvas',
        (level) => {
            const { fill, text } = difficultyToneDark[level];

            expect(wcagContrast(text, over(fill, roleDark.paper))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
            expect(wcagContrast(text, over(fill, roleDark.canvas))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        },
    );

    it.each(['draft', 'private', 'public'] as const)('the %s status reads in dark', (status) => {
        const { fill, text } = statusToneDark[status];

        expect(wcagContrast(text, fill)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('takes the light status fill from the surfaceMuted role (linen), not a palette entry', () => {
        expect(statusTone.public.fill).toBe(role.surfaceMuted);
    });
});

/**
 * The PRO badge: a GREY chip that stands off every muted surface (owner ruling 2026-10-27). The neutral
 * `surfaceMuted` chip it used to be vanished on a `surfaceMuted` area such as the editor's visibility card.
 */
describe('proTone', () => {
    it('is snow on slate in light and charcoal on a light grey in dark, and grey, not steel', () => {
        expect(proTone).toEqual({ fill: '#5C646E', text: '#FFFFFF' });
        expect(proToneDark).toEqual({ fill: '#A3ACB6', text: '#171B20' });
        expect(proTone.fill).toBe(palette.slate);
        expect(proTone.text).toBe(palette.snow);
        expect(proToneDark.text).toBe(palette.charcoal);
        expect([proTone.fill, proToneDark.fill]).not.toContain(palette.steel);
    });

    it.each([
        ['light', proTone],
        ['dark', proToneDark],
    ] as const)('%s: the label clears 4.5:1 on the fill', (_theme, tone) => {
        expect(wcagContrast(tone.text, tone.fill)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    // The bug: the badge vanished on `surfaceMuted`. A not-equal check would pass at 1.01:1, so measure the edge (SC 1.4.11).
    it.each([
        ['light', proTone, role],
        ['dark', proToneDark, roleDark],
    ] as const)('%s: the fill differs from surfaceMuted by at least 3:1', (_theme, tone, theme) => {
        expect(tone.fill).not.toBe(theme.surfaceMuted);
        expect(wcagContrast(tone.fill, theme.surfaceMuted)).toBeGreaterThanOrEqual(3);
    });
});
