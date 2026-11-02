/**
 * The text style of a native text input. On iOS an input carries NO `lineHeight` (React Native's Fabric text input
 * applies a line height as paragraph style without the baseline offset that centres a `Text`, so a taller line box puts
 * the text at its bottom edge), and its size is the design-system body size at the capped scale. On Android the capped
 * leading is set, because an unset one grows with the system scale past the cap. A multi-line input needs its leading on
 * both platforms.
 */
import { describe, expect, it } from 'vitest';

import { scaledTypeSize } from '../../text/scaledType.js';
import { IOS_LEADING_DROP, inputBoxPadding, inputTextStyle, type InputBoxPadding } from '../inputTextStyle.js';

describe('inputTextStyle', () => {
    it.each([1, 1.5, 2, 3.1])('sets the capped body size and NO line height on iOS at scale %s', (scale) => {
        const style = inputTextStyle(scale, 'ios', false);

        expect(style.fontSize).toBe(scaledTypeSize('body', scale).fontSize);
        expect('lineHeight' in style).toBe(false);
    });

    it.each([1, 2, 3.1])('also sets the capped line height on Android at scale %s', (scale) => {
        const style = inputTextStyle(scale, 'android', false);
        const body = scaledTypeSize('body', scale);

        expect(style.fontSize).toBe(body.fontSize);
        expect(style.lineHeight).toBe(body.lineHeight);
    });

    it.each(['ios', 'android'] as const)('keeps the capped line height on %s for a multi-line input', (os) => {
        expect(inputTextStyle(3.1, os, true).lineHeight).toBe(scaledTypeSize('body', 3.1).lineHeight);
    });

    it('stops growing at the 2x cap', () => {
        expect(inputTextStyle(3.1, 'ios', false).fontSize).toBe(inputTextStyle(2, 'ios', false).fontSize);
    });

    it('names the body face', () => {
        expect(typeof inputTextStyle(1, 'ios', false).fontFamily).toBe('string');
    });
});

/*
 * THE CAP-BAND RULE (designer ruling (b), 2026-11-03): an input's text is centred by its cap band, from the top of a
 * capital to the baseline, and descenders hang below. Typed text, placeholders and digits follow the same rule. The
 * platform's own single-line placement already does it: with no shift at all, qa-ios's probe read "Hxg" 1.5 pt low at 16 pt
 * and 3.15 pt low at 32 pt, which is half the descender, so the cap band was centred and the descender hangs. So a
 * single-line input is left exactly as the caller styled it, on both platforms, and numeric inputs need no case of their
 * own. (REWRITTEN: this file used to pin a 0.11 em lift of single-line text and a numeric exemption from it; the lift
 * centred the descender-inclusive ink, which the designer ruled out, and the exemption lost its reason with it.)
 */
describe('inputBoxPadding — a single-line input is left to the platform (the cap band is already centred)', () => {
    it.each(['ios', 'android'] as const)('changes nothing on %s, whatever the size or the caller padding', (os) => {
        expect(inputBoxPadding({ paddingVertical: 12 }, os, false, 1)).toBeUndefined();
        expect(inputBoxPadding({ paddingVertical: 12 }, os, false, 3.1)).toBeUndefined();
        expect(inputBoxPadding({}, os, false, 1)).toBeUndefined();
    });

    it('exports no single-line lift constant', async () => {
        expect(Object.keys(await import('../inputTextStyle.js'))).not.toContain('IOS_INK_DROP_EM');
    });
});

describe('the multi-line first-line drop', () => {
    // The first line's CAP BAND must sit as far from the box top as a single-line field's. qa-ios, iOS, 1x: the Title's
    // cap top is 19.7 pt below its box top with the old 4 pt drop; the unlifted single-line Name's is 18.0, so the drop
    // wants 1.7 pt more, 5.7 pt of the 24 pt leading. At the cap the single line's is about 20.7 and the Title's 25.0 with
    // an 8 pt drop, so 12.3 pt of 48. Both are a quarter of the leading (6 pt at 1x, 12 pt at the cap).
    it('is a quarter of the leading', () => {
        expect(IOS_LEADING_DROP).toBe(1 / 4);
        expect(IOS_LEADING_DROP * 24).toBe(6);
    });

    it('is taken off the top padding on iOS and leaves the bottom, 6 pt at 1x and 12 pt at the cap', () => {
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 1)).toEqual({ paddingTop: 10, paddingBottom: 16 });
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 2)).toEqual({ paddingTop: 4, paddingBottom: 16 });
    });

    it('reads the most specific padding the caller gave, and a style array', () => {
        expect(inputBoxPadding({ padding: 20, paddingVertical: 16, paddingTop: 18 }, 'ios', true, 1)).toEqual({
            paddingTop: 12,
            paddingBottom: 16,
        });
        expect(
            inputBoxPadding([null, false, { paddingVertical: 16 }, undefined, { paddingBottom: 14 }], 'ios', true, 1),
        ).toEqual({
            paddingTop: 10,
            paddingBottom: 14,
        });
    });

    it('never goes below zero', () => {
        expect(
            (inputBoxPadding({ paddingTop: 1, paddingBottom: 0 }, 'ios', true, 3.1) as InputBoxPadding).paddingTop,
        ).toBe(0);
    });

    it('is held on Android (its first line is measured next)', () => {
        expect(inputBoxPadding({ paddingVertical: 16 }, 'android', true, 1)).toBeUndefined();
    });
});
