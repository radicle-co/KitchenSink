/**
 * The numerals and initials in fixed circles, and the pinned bar's title, at 1x, 1.5x, 2x and the cap (designer ruling
 * c10ecadbf, 2026-11-03; `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`), on the app's real font metrics.
 *
 *  1. A step numeral caps at 1.5x, like chrome. Its circle is at least 32 pt and grows to the numeral's height plus 8, so two
 *     digits always fit (`numeralDiscOf`).
 *  2. Initials do not scale. They are drawn at 40% of the disc's diameter (`initialsPxOf`), so two letters fit at every size;
 *     the name beside the avatar, or its accessible name, carries the meaning.
 *  3. The pinned bar's title and parent name cap at 1.5x, and the bar is at least 56 pt and grows to fit (`PINNED_BAR_HEIGHT`
 *     is the minimum), so one line of either always fits.
 *
 * jsdom lays nothing out, so widths come from the font (`measureTextWidth`) and sizes from the app's own functions. The
 * widest plausible content is used: "99" for a step and "MW" for initials (the two widest capitals). A small margin covers
 * kerning and hinting.
 */
import { describe, expect, it } from 'vitest';

import { AVATAR_DISC_PT } from '@commise/ui/avatar-props';
import { initialsPxOf } from '@commise/ui/avatar-initials';
import { PINNED_BAR_HEIGHT } from '@commise/ui/bar-geometry';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { NUMERAL_DISC_MIN, numeralDiscOf } from '../numeralDisc.js';

const SCALES = [1, 1.5, 2, 3.1] as const;
const MARGIN = 1.04;

/** The discovery footer's avatar disc, the third size (`DiscoveryFooter.native.tsx`: 20 pt). */
const FOOTER_DISC = 20;

describe('a step numeral caps at 1.5x, and its circle holds two digits', () => {
    describe.each(['caption', 'label'] as const)('role %s', (role) => {
        const face = asLoadedFace(nativeTokens.type[role].fontFamily);

        it.each(SCALES)('system scale %fx', (scale) => {
            const { fontSize, lineHeight } = scaledTypeSize(role, scale, '1.5');
            const disc = numeralDiscOf(role, scale);

            expect(fontSize).toBeLessThanOrEqual(nativeTokens.type[role].fontSize * 1.5);
            expect(disc).toBeGreaterThanOrEqual(NUMERAL_DISC_MIN);
            expect(disc).toBeGreaterThanOrEqual(lineHeight + 8);
            expect(measureTextWidth('99', face, fontSize) * MARGIN).toBeLessThanOrEqual(disc);
        });

        it('is 32 pt at the default scale and grows past it by 1.5x', () => {
            expect(numeralDiscOf(role, 1)).toBe(32);
            expect(numeralDiscOf(role, 1.5)).toBe(38);
        });

        it('stops growing at the cap: 2x and 3.1x give the 1.5x circle', () => {
            expect(numeralDiscOf(role, 2)).toBe(numeralDiscOf(role, 1.5));
            expect(numeralDiscOf(role, 3.1)).toBe(numeralDiscOf(role, 1.5));
        });
    });
});

describe('initials do not scale: 40% of the disc, so two letters fit at every size', () => {
    const face = asLoadedFace(nativeTokens.type.label.fontFamily);

    it.each([
        ['the default avatar disc', AVATAR_DISC_PT.default],
        ['the large avatar disc', AVATAR_DISC_PT.large],
        ["the discovery footer's disc", FOOTER_DISC],
    ] as const)('%s (%i pt)', (_name, disc) => {
        const px = initialsPxOf(disc);

        expect(px).toBeLessThanOrEqual(disc * 0.4);
        expect(px).toBeGreaterThan(disc * 0.4 - 2);
        expect(px % 2).toBe(0);
        expect(measureTextWidth('MW', face, px) * MARGIN).toBeLessThanOrEqual(disc);
        // The leading is the size plus 4: it stays inside the disc.
        expect(px + 4).toBeLessThanOrEqual(disc);
    });

    it('is 12 pt in the 32 pt disc, 14 pt in the 36 pt disc and 8 pt in the 20 pt disc', () => {
        expect([32, 36, 20].map(initialsPxOf)).toEqual([12, 14, 8]);
    });

    it('would not have fit at the old size: "MW" at the 2x label cap overflows the 32 pt disc', () => {
        const { fontSize } = scaledTypeSize('label', 2);

        expect(measureTextWidth('MW', face, fontSize)).toBeGreaterThan(AVATAR_DISC_PT.default);
    });
});

describe("the pinned bar's title and parent name cap at 1.5x, in a bar of at least 56 pt", () => {
    it.each(SCALES)('one line of either fits at system scale %fx', (scale) => {
        for (const role of ['barTitle', 'label'] as const) {
            const { lineHeight } = scaledTypeSize(role, scale, '1.5');

            expect(lineHeight).toBeLessThanOrEqual(PINNED_BAR_HEIGHT);
        }
    });

    it('is the 56 pt minimum', () => {
        expect(PINNED_BAR_HEIGHT).toBe(56);
    });
});
