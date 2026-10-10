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
import { difficultyTone, difficultyToneDark, proTone, statusTone, statusToneDark } from '../tones.js';

const toRgb = converter('rgb');

/** WCAG 2.1 AA, SC 1.4.3 — a badge label is caption-sized text. */
const AA_NORMAL_TEXT = 4.5;

describe('difficultyTone', () => {
    it('is keyed by exactly the three difficulties', () => {
        expect(Object.keys(difficultyTone).sort()).toEqual(['easy', 'hard', 'medium']);
    });

    it('uses the spec’s tints and labels', () => {
        expect(difficultyTone).toEqual({
            easy: { fill: tint(palette.success, 0.15), text: role.actionText },
            medium: { fill: tint(palette.warning, 0.15), text: role.attention },
            hard: { fill: tint(palette.coral, 0.15), text: role.ink },
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

    it('gives each difficulty its own fill, so the three never read as one', () => {
        const fills = Object.values(difficultyTone).map((tone) => tone.fill);

        expect(new Set(fills).size).toBe(fills.length);
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
    it('uses the spec’s dark tints and labels', () => {
        expect(difficultyToneDark).toEqual({
            easy: { fill: tint(palette.success, 0.18), text: roleDark.actionText },
            medium: { fill: tint(palette.warning, 0.18), text: roleDark.attention },
            hard: { fill: tint(palette.coral, 0.18), text: roleDark.ink },
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

/** The PRO badge: one fixed pair in both themes (`darkTheme.md` §2, "Premium (PRO)"), so it is not re-themed. */
describe('proTone', () => {
    it('is premium under charcoal, in both themes', () => {
        expect(proTone).toEqual({ fill: palette.premium, text: palette.charcoal });
        expect(wcagContrast(proTone.text, proTone.fill)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
});
