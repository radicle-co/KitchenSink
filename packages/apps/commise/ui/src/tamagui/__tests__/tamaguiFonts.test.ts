/**
 * The Tamagui fonts carry the type scale's sizes and leadings, and name only REGISTERED faces. A CSS font stack or the
 * bare family name `'Inter'` is not a face React Native can resolve: it falls back to the system face without an
 * error, which is the failure this test exists to catch. Every line height is a `px` string, because Tamagui 3 reads a
 * bare number as a ratio of the font size (`tamaguiRuntimeProbe.native.test.tsx`).
 */
import { describe, expect, it } from 'vitest';

import { bodyFontFace, displayFontFace, fontWeight, lineHeightPx } from '../../tokens/scale.js';
import { TYPE_SIZES } from '../../tokens/typography.js';
import { tamaguiFonts } from '../tamaguiFonts.js';

const fonts = Object.entries(tamaguiFonts);

describe('tamaguiFonts', () => {
    it('defines a body and a heading font', () => {
        expect(Object.keys(tamaguiFonts).sort()).toEqual(['body', 'heading']);
    });

    it.each(fonts)('%s: has exactly the scale’s sizes', (_name, font) => {
        expect(font.size).toEqual(Object.fromEntries(TYPE_SIZES.map((size) => [size, size])));
    });

    it.each(fonts)('%s: gives each size its leading as a px string', (_name, font) => {
        for (const size of TYPE_SIZES) {
            expect(font.lineHeight[size], `${size}`).toBe(`${lineHeightPx[size]}px`);
        }
    });

    it('names a registered body face for every body weight, and nothing else', () => {
        const faces = tamaguiFonts.body.face;

        expect(faces[fontWeight.normal].normal).toBe(bodyFontFace.normal);
        expect(faces[fontWeight.medium].normal).toBe(bodyFontFace.medium);
        expect(faces[fontWeight.semibold].normal).toBe(bodyFontFace.semibold);
        expect(tamaguiFonts.body.family).toBe(bodyFontFace.normal);
    });

    it('names the registered display face for the heading font', () => {
        const faces = tamaguiFonts.heading.face;

        expect(faces[fontWeight.semibold].normal).toBe(displayFontFace.semibold);
        expect(tamaguiFonts.heading.family).toBe(displayFontFace.semibold);
    });

    it('never names a CSS font stack', () => {
        for (const [, font] of fonts) {
            expect(font.family).not.toMatch(/[,"]/);
        }
    });
});
