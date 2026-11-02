/**
 * The text style of a native text input. On iOS an input carries NO `lineHeight` (React Native's Fabric text input
 * applies a line height as paragraph style without the baseline offset that centres a `Text`, so a taller line box puts
 * the text at its bottom edge), and its size is the design-system body size at the capped scale. On Android the capped
 * leading is set, because an unset one grows with the system scale past the cap. A multi-line input needs its leading on
 * both platforms.
 */
import { describe, expect, it } from 'vitest';

import { scaledTypeSize } from '../../text/scaledType.js';
import { inputTextStyle } from '../inputTextStyle.js';

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
