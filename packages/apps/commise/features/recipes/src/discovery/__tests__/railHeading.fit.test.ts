/**
 * A Discover rail heading and its "See all" link at the largest text size (designer ruling, designAnswers.md 2026-11-01,
 * "See all under its title"; the defect was seen on iOS at the cap, Discover_light_cap_b1611, where the link read "See a"):
 * when the heading and the link do not fit on one row, the link wraps onto its own line under the heading, its text on the
 * title's start edge, its target at least 48 pt tall. It never truncates and never shrinks.
 *
 * jsdom lays nothing out, so the widths come from the font (`measureTextWidth`) at the size each role is drawn at for the
 * scale (`scaledTypeSize`), in English and the pseudo-locale that grows it by 35%. The row is the window less the screen's two
 * 16 pt gutters. The layout rule itself (a wrapping row, a link that cannot shrink) is pinned by the component tests; this
 * proves the two things that rule needs to be enough: that the link ALONE always fits a row, and that the longest word of
 * the title always fits one, so nothing is ever cut.
 */
import { describe, expect, it } from 'vitest';

import { PSEUDO_LOCALE, pseudoString, resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { discoveryMessages } from '../messages.js';
import { RAIL_LINK_INSET, RAIL_LINK_MIN_HEIGHT, RAIL_LINK_PADDING } from '../railHeading.js';

const WIDTHS = [320, 390] as const;
/** 1x, and the cap: the title (sectionTitle) stops at 1.5x and the link (cardTitle) at 2x, so 3.1x is the cap for both. */
const SCALES = [1, 3.1] as const;
const GUTTER = nativeTokens.spacing[4];
const GAP = nativeTokens.spacing[2];
const MARGIN = 1.04;

const LOCALES = [...SUPPORTED_LOCALES, PSEUDO_LOCALE] as const;

const textsOf = (locale: string) => {
    const pseudo = locale === PSEUDO_LOCALE;
    const { railTrending, railNew, railQuick, cuisinesTitle, seeAll } = resolveMessages(
        discoveryMessages,
        pseudo ? 'en' : locale,
    );
    const say = (text: string): string => (pseudo ? pseudoString(text) : text);

    return {
        titles: [railTrending, railNew, railQuick, cuisinesTitle].map(say),
        link: say(seeAll),
    };
};

const widthOf = (text: string, role: 'sectionTitle' | 'cardTitle', scale: number): number =>
    measureTextWidth(text, asLoadedFace(nativeTokens.type[role].fontFamily), scaledTypeSize(role, scale).fontSize);

const longestWord = (text: string): string => text.split(/\s+/u).reduce((a, w) => (w.length > a.length ? w : a), '');

describe.each(LOCALES)('Discover rail headings · %s', (locale) => {
    const { titles, link } = textsOf(locale);

    describe.each(WIDTHS)('%i pt wide', (width) => {
        const row = width - 2 * GUTTER;

        it.each(SCALES)(
            'the link alone fits a row at %fx, with its padding, so it can wrap and never be cut',
            (scale) => {
                const target = widthOf(link, 'cardTitle', scale) * MARGIN + 2 * RAIL_LINK_PADDING;

                expect(target).toBeLessThanOrEqual(row + RAIL_LINK_INSET);
            },
        );

        it.each(SCALES)('the longest word of every title fits a row at %fx', (scale) => {
            for (const title of titles) {
                expect(widthOf(longestWord(title), 'sectionTitle', scale) * MARGIN).toBeLessThanOrEqual(row);
            }
        });
    });
});

describe('the wrap is needed (the fit test is not vacuous)', () => {
    it('at 320 pt, at the cap, in the pseudo-locale, a heading and its link do not fit one row', () => {
        const { titles, link } = textsOf(PSEUDO_LOCALE);
        const row = 320 - 2 * GUTTER;

        expect(
            titles.some(
                (title) =>
                    widthOf(title, 'sectionTitle', 3.1) +
                        GAP +
                        widthOf(link, 'cardTitle', 3.1) +
                        2 * RAIL_LINK_PADDING >
                    row,
            ),
        ).toBe(true);
    });
});

describe('the link target', () => {
    it("is at least 48 pt tall and pulled back by the button's own padding, so its text sits on the title's edge", () => {
        expect(RAIL_LINK_MIN_HEIGHT).toBeGreaterThanOrEqual(48);
        expect(RAIL_LINK_INSET).toBe(RAIL_LINK_PADDING);
    });
});
