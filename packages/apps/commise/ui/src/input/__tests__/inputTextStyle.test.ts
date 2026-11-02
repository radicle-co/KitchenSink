/**
 * The text style of a native text input. On iOS an input carries NO `lineHeight` (React Native's Fabric text input
 * applies a line height as paragraph style without the baseline offset that centres a `Text`, so a taller line box puts
 * the text at its bottom edge), and its size is the design-system body size at the capped scale. On Android the capped
 * leading is set, because an unset one grows with the system scale past the cap. A multi-line input needs its leading on
 * both platforms.
 */
import { describe, expect, it } from 'vitest';

import { scaledTypeSize } from '../../text/scaledType.js';
import {
    IOS_INK_DROP_EM,
    IOS_LEADING_DROP,
    inputBoxPadding,
    inputTextStyle,
    type InputBoxPadding,
} from '../inputTextStyle.js';

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

/** The vertical centre of the text area a padding leaves, relative to the box: lower is higher up. */
const centreOf = (box: number, { paddingTop, paddingBottom }: InputBoxPadding): number =>
    (paddingTop + box - paddingBottom) / 2;

describe('the measured iOS offsets, each stated once', () => {
    // qa-ios measured the single-line ink 2 pt below the centre at 16 pt and 3.5 pt at 32 pt: about 0.11 em.
    it('names the single-line ink drop as a fraction of the font size', () => {
        expect(IOS_INK_DROP_EM).toBe(0.11);
    });

    // The designer measured the first line of a multi-line field about 4 pt low under a 24 pt leading, and the first-line
    // check (qaChecks, 2026-11-03) wants its gap above within 2 pt of a single-line field's: qa-ios's Title read 3.4 pt
    // more at 1x. Together 7.5 pt at the 24 pt body leading, which is 5/16 of it and 15 pt at the cap.
    it('names the multi-line first-line drop as a fraction of the leading, 7.5 pt at the 24 pt body leading', () => {
        expect(IOS_LEADING_DROP * 24).toBe(7.5);
    });
});

describe('inputBoxPadding — a numeric input', () => {
    // Digits have no descenders, so their ink is centred on the line's own middle: the lift that centres "Hxg" would put
    // them high. A numeric input is not offset on any platform.
    it.each([true, false])('is left as the caller styled it on iOS (multi-line %s)', (multiline) => {
        expect(inputBoxPadding({ paddingVertical: 12 }, 'ios', multiline, 1, true)).toBeUndefined();
    });
});

describe('inputBoxPadding', () => {
    const box = 48;

    it('raises a single-line ink by the drop on iOS without changing the field height', () => {
        const drop = 16 * IOS_INK_DROP_EM;
        const padded = inputBoxPadding({ paddingVertical: 12 }, 'ios', false, 1, false);

        expect(padded).toBeDefined();
        expect(centreOf(box, padded as InputBoxPadding)).toBeCloseTo(box / 2 - drop, 5);
        expect((padded as InputBoxPadding).paddingTop + (padded as InputBoxPadding).paddingBottom).toBeCloseTo(24, 5);
    });

    it('scales the drop with the capped size, so the ink is centred at the cap too', () => {
        const drop = 32 * IOS_INK_DROP_EM;
        const padded = inputBoxPadding({ paddingVertical: 12 }, 'ios', false, 3.1, false) as InputBoxPadding;

        expect(centreOf(box, padded)).toBeCloseTo(box / 2 - drop, 5);
    });

    it('takes it from the bottom when there is no top padding to give, which grows the field by the drop twice', () => {
        const padded = inputBoxPadding({}, 'ios', false, 1, false) as InputBoxPadding;
        const drop = 16 * IOS_INK_DROP_EM;

        expect(padded.paddingTop).toBe(0);
        expect(padded.paddingBottom).toBeCloseTo(2 * drop, 5);
    });

    it('reads the most specific padding the caller gave', () => {
        const padded = inputBoxPadding(
            { padding: 20, paddingVertical: 12, paddingTop: 8 },
            'ios',
            false,
            1,
        ) as InputBoxPadding;
        const drop = 16 * IOS_INK_DROP_EM;

        expect(padded.paddingTop).toBeCloseTo(8 - drop, 5);
        expect(padded.paddingBottom).toBeCloseTo(12 + drop, 5);
    });

    it('leaves a multi-line field its bottom and takes the leading drop off the top, 7.5 pt at 1x and 15 pt at the cap', () => {
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 1, false)).toEqual({
            paddingTop: 8.5,
            paddingBottom: 16,
        });
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 2, false)).toEqual({
            paddingTop: 1,
            paddingBottom: 16,
        });
    });

    it('never goes below zero', () => {
        expect(
            (inputBoxPadding({ paddingTop: 1, paddingBottom: 0 }, 'ios', true, 3.1, false) as InputBoxPadding)
                .paddingTop,
        ).toBe(0);
    });

    // qa-device, clean frames (committed text, caret off), Android 1.0: five single-line text fields read 1.5 to 1.7 pt
    // low in a 50 dp box, which is the descender drop (0.11 em of 16) the iOS probe found. Android lifts them the same.
    it('lifts a single-line input on Android exactly as on iOS, the height unchanged', () => {
        const android = inputBoxPadding({ paddingVertical: 12 }, 'android', false, 1) as InputBoxPadding;

        expect(android).toEqual(inputBoxPadding({ paddingVertical: 12 }, 'ios', false, 1));
        expect(android.paddingTop + android.paddingBottom).toBeCloseTo(24, 5);
        expect(android.paddingBottom - 12).toBeCloseTo(16 * IOS_INK_DROP_EM, 5);
    });

    it('leaves a multi-line input on Android alone (its first line is held for the next measurement)', () => {
        expect(inputBoxPadding({ paddingVertical: 16 }, 'android', true, 1, false)).toBeUndefined();
    });

    it('leaves a numeric input on Android alone', () => {
        expect(inputBoxPadding({ paddingVertical: 12 }, 'android', false, 1, true)).toBeUndefined();
    });

    it('reads a style array and skips what is not a style', () => {
        const padded = inputBoxPadding(
            [null, false, { paddingVertical: 12 }, undefined, { paddingBottom: 14 }],
            'ios',
            false,
            1,
        );

        expect((padded as InputBoxPadding).paddingBottom).toBeCloseTo(14 + 16 * IOS_INK_DROP_EM, 5);
    });
});
