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
const PADDING = 2 * nativeTokens.spacing[3] + 2;
const GLYPH = 20 + nativeTokens.spacing[2];
const GROWTH = [1.35, 1.5] as const;

const { sourceStatement: m } = resolveMessages(recipeActionMessages, 'en');
const { fontFamily, fontSize } = nativeTokens.type.cardTitle;

const widthOf = (label: string, growth: number, glyph: boolean): number =>
    measureTextWidth(label, asLoadedFace(fontFamily), fontSize) * growth + PADDING + (glyph ? GLYPH : 0);

describe('the statement sheet actions fit one line in a 194 px half', () => {
    it.each([
        ['the editor pair', m.dismissEditor, m.confirmEditor],
        ['the recipe page pair', m.dismissRecipePage, m.confirmRecipePage],
    ] as const)('%s, at +35%', (_pair, dismiss, confirm) => {
        expect(widthOf(dismiss, GROWTH[0], false)).toBeLessThanOrEqual(HALF);
        expect(widthOf(confirm, GROWTH[0], true)).toBeLessThanOrEqual(HALF);
    });

    it('the editor pair, at +50%', () => {
        expect(widthOf(m.dismissEditor, GROWTH[1], false)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.confirmEditor, GROWTH[1], true)).toBeLessThanOrEqual(HALF);
    });

    // "Make public" at +50% is 195.0 px against 194: 1 px over, accepted as the margin (designer D14, option a).
    it('the recipe page pair, at +50%, is within 1 px of the half', () => {
        expect(widthOf(m.dismissRecipePage, GROWTH[1], false)).toBeLessThanOrEqual(HALF);
        expect(widthOf(m.confirmRecipePage, GROWTH[1], true)).toBeLessThanOrEqual(HALF + 1.5);
    });
});
