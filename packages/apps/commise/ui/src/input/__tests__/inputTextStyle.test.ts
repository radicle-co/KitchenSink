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

    // The designer measured the first line of a multi-line field about 4 pt low under a 24 pt leading: one sixth of it.
    it('names the multi-line first-line drop as a fraction of the leading, 4 pt at the 24 pt body leading', () => {
        expect(IOS_LEADING_DROP * 24).toBe(4);
    });
});

describe('inputBoxPadding', () => {
    const box = 48;

    it('raises a single-line ink by the drop on iOS without changing the field height', () => {
        const drop = 16 * IOS_INK_DROP_EM;
        const padded = inputBoxPadding({ paddingVertical: 12 }, 'ios', false, 1);

        expect(padded).toBeDefined();
        expect(centreOf(box, padded as InputBoxPadding)).toBeCloseTo(box / 2 - drop, 5);
        expect((padded as InputBoxPadding).paddingTop + (padded as InputBoxPadding).paddingBottom).toBeCloseTo(24, 5);
    });

    it('scales the drop with the capped size, so the ink is centred at the cap too', () => {
        const drop = 32 * IOS_INK_DROP_EM;
        const padded = inputBoxPadding({ paddingVertical: 12 }, 'ios', false, 3.1) as InputBoxPadding;

        expect(centreOf(box, padded)).toBeCloseTo(box / 2 - drop, 5);
    });

    it('takes it from the bottom when there is no top padding to give, which grows the field by the drop twice', () => {
        const padded = inputBoxPadding({}, 'ios', false, 1) as InputBoxPadding;
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

    it('leaves a multi-line field its bottom and takes the leading drop off the top, 4 pt at 1x and 8 pt at the cap', () => {
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 1)).toEqual({ paddingTop: 12, paddingBottom: 16 });
        expect(inputBoxPadding({ paddingVertical: 16 }, 'ios', true, 3.1)).toEqual({
            paddingTop: 8,
            paddingBottom: 16,
        });
    });

    it('never goes below zero', () => {
        expect(
            (inputBoxPadding({ paddingTop: 1, paddingBottom: 0 }, 'ios', true, 3.1) as InputBoxPadding).paddingTop,
        ).toBe(0);
    });

    it('changes nothing on Android', () => {
        expect(inputBoxPadding({ paddingVertical: 12 }, 'android', false, 1)).toBeUndefined();
        expect(inputBoxPadding({ paddingVertical: 16 }, 'android', true, 1)).toBeUndefined();
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
