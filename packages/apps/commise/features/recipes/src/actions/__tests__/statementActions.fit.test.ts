/**
 * The statement sheet's two footer actions at `DialogActions` 400 with equal shares (KTD6, `ui/dialog-actions/props.ts`):
 * each pair must fit ONE line in a 194 px half (a 400 box less the 12 px gap) at +35% and +50% label growth for a
 * translation, so a row that the threshold allows never wraps a label. jsdom lays nothing out, so the widths come from the
 * font (`measureTextWidth`) in the button label role (`cardTitle`), and the half is the box less the button's own
 * chrome: 12 pt padding on each side, 1 px border on each side, and, on the confirm, a 20 px glyph and the 8 pt gap.
 */
import { describe, expect, it } from 'vitest';

import { resolveMessages } from '@commise/i18n';
import { nativeTokens } from '@commise/ui/native';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { recipeActionMessages } from '../messages.js';

const HALF = (400 - nativeTokens.spacing[3]) / 2;
const GLYPH = 20 + nativeTokens.spacing[2];
const GROWTH = [1.35, 1.5] as const;
/** Each platform's button chrome: inline padding on both sides (native 12 pt; web `md:px-5`, 20 px) and the two 1 px borders. */
const CHROME = [['native', 2 * nativeTokens.spacing[3] + 2]] as const;
/** The web button's chrome: `md:px-5`, 20 px each side, and the two 1 px borders. */
const WEB_CHROME = 2 * 20 + 2;

const { sourceStatement: m } = resolveMessages(recipeActionMessages, 'en');
const { fontFamily, fontSize } = nativeTokens.type.cardTitle;

const widthOf = (label: string, growth: number, glyph: boolean, chrome: number): number =>
    measureTextWidth(label, asLoadedFace(fontFamily), fontSize) * growth + chrome + (glyph ? GLYPH : 0);

describe.each(CHROME)('the statement sheet actions fit one line in a 194 px half (%s chrome)', (_platform, chrome) => {
    it.each([
        ['the editor pair', m.dismissEditor, m.confirmEditor],
        ['the recipe page pair', m.dismissRecipePage, m.confirmRecipePage],
    ] as const)('%s, at +35%', (_pair, dismiss, confirm) => {
        expect(widthOf(dismiss, GROWTH[0], false, chrome)).toBeLessThanOrEqual(HALF);
        expect(widthOf(confirm, GROWTH[0], true, chrome)).toBeLessThanOrEqual(HALF);
    });

    it('the editor pair, at +50%', () => {
        expect(widthOf(m.dismissEditor, GROWTH[1], false, chrome)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.confirmEditor, GROWTH[1], true, chrome)).toBeLessThanOrEqual(HALF);
    });

    // "Make public" at +50% is 195.0 px against 194 on native chrome: 1 px over, accepted as the margin (designer D14, option a).
    it('the recipe page pair, at +50%, is within 1 px of the half', () => {
        expect(widthOf(m.dismissRecipePage, GROWTH[1], false, chrome)).toBeLessThanOrEqual(HALF);
        expect(Math.round(widthOf(m.confirmRecipePage, GROWTH[1], true, chrome))).toBeLessThanOrEqual(HALF + 1);
    });
});

/**
 * Web chrome is wider than native, so the bound is lower (designer D15, option a): every English label fits, "Make public"
 * holds one line to +31% (124 px of label room over its 94.0) and the other labels to +35%. Past that a label wraps to two
 * lines inside its half and is never cut off. A locale is re-measured when it ships.
 */
describe('the statement sheet actions fit one line in a 194 px half (web chrome)', () => {
    it('English labels, every one', () => {
        for (const label of [m.dismissEditor, m.dismissRecipePage]) {
            expect(widthOf(label, 1, false, WEB_CHROME)).toBeLessThanOrEqual(HALF);
        }

        for (const label of [m.confirmEditor, m.confirmRecipePage]) {
            expect(widthOf(label, 1, true, WEB_CHROME)).toBeLessThanOrEqual(HALF);
        }
    });

    it('"Make public" to +31%, and the other three labels to +35%', () => {
        expect(widthOf(m.confirmRecipePage, 1.31, true, WEB_CHROME)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.dismissEditor, GROWTH[0], false, WEB_CHROME)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.confirmEditor, GROWTH[0], true, WEB_CHROME)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.dismissRecipePage, GROWTH[0], false, WEB_CHROME)).toBeLessThanOrEqual(HALF);
    });
});
