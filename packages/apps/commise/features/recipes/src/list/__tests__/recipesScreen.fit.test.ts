/**
 * The Recipes screen's title, filter chips, result count and sort control at the largest text size (designer finding C-1,
 * `docs/design/uiRefreshWorkshop5/nativeBoards/reviews/mergedUiIos1.md`: on iOS they grew to about 3x and broke inside their
 * words, "Recipe / s"). Each is the design-system Text now, which stops at its role's ceiling; this test measures, on the
 * app's real font metrics, that at 320 and 390 pt, 1x and the cap (3.1x, the iOS accessibility maximum), in English and the
 * pseudo-locale that grows it by 35%, what is left of each fits a row with whole words:
 *
 *  - the title: its longest word at `largeTitle`, which stops at 1.5x, against the row (the window less two 16 pt gutters);
 *  - a filter chip: its longest word at `caption` (2x) against the chip's room, less its padding, edge, check and count;
 *  - the count: its longest word at `label` (2x) against the row;
 *  - the sort control: its longest word at `cardTitle` (2x) with the button's padding, gap and chevron, against the row,
 *    because the result bar wraps and the control moves to its own line;
 *  - the list/grid switch: its fixed 112 against the row.
 *
 * The known-bad rows measure the same title at the uncapped 3.1x, which is what iOS drew.
 */
import { describe, expect, it } from 'vitest';

import { PSEUDO_LOCALE, pseudoString, resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { recipeMessages } from '../../messages.js';
import { LIBRARY_SORTS, sortLabelOf } from '../library.js';

const WIDTHS = [320, 390] as const;
const SCALES = [1, 3.1] as const;
const GUTTER = nativeTokens.spacing[4];
const MARGIN = 1.04;

/** The chip's own chrome: padding and edge on each side, the check while selected, and the gaps. */
const CHIP_PADDING = nativeTokens.spacing[3];
const CHIP_EDGE = 1.5;
const CHIP_GAP = nativeTokens.spacing[1];
const CHECK = 16;
/** The ghost `sm` button: padding each side, the gap to its chevron, and the chevron. */
const BUTTON_PADDING = nativeTokens.spacing[3];
const BUTTON_GAP = nativeTokens.spacing[2];
const CHEVRON = 20;
/** The list/grid switch's fixed width (`RecipeListResults.native.tsx`). */
const VIEW_SWITCH = 112;

type Role = Parameters<typeof scaledTypeSize>[0];

/** A role's face: `largeTitle` has one style per container class, all three equal today. */
const faceOf = (role: Role): string =>
    role === 'largeTitle' ? nativeTokens.type.largeTitle.regular.fontFamily : nativeTokens.type[role].fontFamily;

const widthOf = (text: string, role: Role, scale: number): number =>
    measureTextWidth(text, asLoadedFace(faceOf(role)), scaledTypeSize(role, scale).fontSize);

const longestWord = (text: string): string => text.split(/\s+/u).reduce((a, w) => (w.length > a.length ? w : a), '');

const LOCALES = [...SUPPORTED_LOCALES, PSEUDO_LOCALE] as const;

const textsOf = (locale: string) => {
    const pseudo = locale === PSEUDO_LOCALE;
    const { list } = resolveMessages(recipeMessages, pseudo ? 'en' : locale);
    const say = (text: string): string =>
        pseudo ? pseudoString(text.replace('{count}', '99')) : text.replace('{count}', '99');

    return {
        title: say(list.heading),
        chips: [list.filterAll, list.filterQuick].map(say),
        counts: [list.countOne, list.countOther].map(say),
        sorts: LIBRARY_SORTS.map((sort) => say(sortLabelOf(sort, list))),
    };
};

describe.each(LOCALES)('Recipes screen · %s', (locale) => {
    const texts = textsOf(locale);

    describe.each(WIDTHS)('%i pt wide', (width) => {
        const row = width - 2 * GUTTER;

        it.each(SCALES)("the title's longest word fits the row at %fx", (scale) => {
            expect(widthOf(longestWord(texts.title), 'largeTitle', scale) * MARGIN).toBeLessThanOrEqual(row);
        });

        it.each(SCALES)("every chip's longest word fits its room at %fx, selected and with a count", (scale) => {
            const room =
                row - 2 * (CHIP_PADDING + CHIP_EDGE) - CHECK - CHIP_GAP - widthOf('99', 'label', scale) - CHIP_GAP;

            for (const chip of texts.chips) {
                expect(widthOf(longestWord(chip), 'caption', scale) * MARGIN).toBeLessThanOrEqual(room);
            }
        });

        it.each(SCALES)("the count's longest word fits the row at %fx", (scale) => {
            for (const count of texts.counts) {
                expect(widthOf(longestWord(count), 'label', scale) * MARGIN).toBeLessThanOrEqual(row);
            }
        });

        it.each(SCALES)('the sort control alone fits the row at %fx, with its padding, gap and chevron', (scale) => {
            const chrome = 2 * BUTTON_PADDING + BUTTON_GAP + CHEVRON;

            for (const sort of texts.sorts) {
                expect(widthOf(longestWord(sort), 'cardTitle', scale) * MARGIN + chrome).toBeLessThanOrEqual(row);
            }
        });

        it('the list/grid switch fits the row', () => {
            expect(VIEW_SWITCH).toBeLessThanOrEqual(row);
        });
    });
});

describe('the harness can fail (known-bad inputs)', () => {
    it('the title at the uncapped 3.1x, which is what iOS drew, does not fit a 320 pt row', () => {
        const face = asLoadedFace(nativeTokens.type.largeTitle.regular.fontFamily);
        const uncapped = measureTextWidth('Recipes', face, nativeTokens.type.largeTitle.regular.fontSize * 3.1);

        expect(uncapped * MARGIN).toBeGreaterThan(320 - 2 * GUTTER);
    });

    it('the title at its 1.5x cap fits the same row', () => {
        expect(widthOf('Recipes', 'largeTitle', 3.1) * MARGIN).toBeLessThanOrEqual(320 - 2 * GUTTER);
    });
});
