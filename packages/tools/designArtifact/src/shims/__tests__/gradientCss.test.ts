import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { linearGradientCss } from '../gradientCss.js';

const SQUARE = { width: 100, height: 100 };

describe('linearGradientCss', () => {
    const cases = [
        {
            name: 'defaults to top to bottom, the default points of expo-linear-gradient',
            input: { colors: ['#000', '#fff'] },
            css: 'linear-gradient(180deg, #000 0%, #fff 100%)',
        },
        {
            name: 'left to right',
            input: { colors: ['red', 'blue'], start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
            css: 'linear-gradient(90deg, red 0%, blue 100%)',
        },
        {
            name: 'bottom to top',
            input: { colors: ['red', 'blue'], start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } },
            css: 'linear-gradient(0deg, red 0%, blue 100%)',
        },
        {
            name: 'right to left',
            input: { colors: ['red', 'blue'], start: { x: 1, y: 0 }, end: { x: 0, y: 0 } },
            css: 'linear-gradient(270deg, red 0%, blue 100%)',
        },
        {
            name: 'top-left to bottom-right of a square',
            input: { colors: ['red', 'blue'], start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
            css: 'linear-gradient(135deg, red 0%, blue 100%)',
        },
        {
            name: 'bottom-left to top-right of a square',
            input: { colors: ['red', 'blue'], start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
            css: 'linear-gradient(45deg, red 0%, blue 100%)',
        },
        {
            name: 'tuple points, as expo accepts them',
            input: { colors: ['red', 'blue'], start: [0, 0.5], end: [1, 0.5] },
            css: 'linear-gradient(90deg, red 0%, blue 100%)',
        },
        {
            name: 'a tuple start with an object end',
            input: { colors: ['red', 'blue'], start: [0.5, 1], end: { x: 0.5, y: 0 } },
            css: 'linear-gradient(0deg, red 0%, blue 100%)',
        },
        {
            name: 'locations as percentages without float noise',
            input: { colors: ['a', 'b', 'c'], locations: [0, 0.3, 1] },
            css: 'linear-gradient(180deg, a 0%, b 30%, c 100%)',
        },
        {
            name: 'no locations spreads the stops evenly, as the device does',
            input: { colors: ['a', 'b', 'c', 'd'] },
            css: 'linear-gradient(180deg, a 0%, b 33.3333%, c 66.6667%, d 100%)',
        },
        {
            name: 'a null locations list',
            input: { colors: ['a', 'b'], locations: null },
            css: 'linear-gradient(180deg, a 0%, b 100%)',
        },
        {
            name: 'locations shorter than colours spread the rest evenly',
            input: { colors: ['a', 'b', 'c'], locations: [0, 0.5] },
            css: 'linear-gradient(180deg, a 0%, b 50%, c 100%)',
        },
        {
            name: 'a single colour is painted flat (CSS needs two stops)',
            input: { colors: ['a'] },
            css: 'linear-gradient(180deg, a 0%, a 100%)',
        },
        {
            name: 'identical points paint the last colour flat (nothing to interpolate along)',
            input: { colors: ['a', 'b'], start: { x: 0.2, y: 0.2 }, end: { x: 0.2, y: 0.2 } },
            css: 'linear-gradient(180deg, b 0%, b 100%)',
        },
        {
            name: 'a segment shorter than the box starts and ends inside it',
            input: { colors: ['a', 'b'], start: { x: 0.5, y: 0.25 }, end: { x: 0.5, y: 0.75 } },
            css: 'linear-gradient(180deg, a 25%, b 75%)',
        },
    ] as const;

    it.each(cases)('$name', ({ input, css }) => {
        expect(linearGradientCss(input, SQUARE)).toBe(css);
    });

    describe('in a box that is not square', () => {
        // The product's 135deg wash as toNativeGradient projects it: a unit-length vector centred on the box.
        const diagonal = { start: { x: 0.1464, y: 0.1464 }, end: { x: 0.8536, y: 0.8536 } };

        it('takes the angle from the segment in pixels, as the device and expo’s web adapter do', () => {
            // atan2 of the pixel vector (275.8, 141.4): 90 + 27.15 = 117.15deg, not the 135deg of the unit square.
            const css = linearGradientCss({ colors: ['a', 'b'], ...diagonal }, { width: 390, height: 200 });

            expect(css).toMatch(/^linear-gradient\(117\.1\d+deg, /u);
        });

        it('places the stops on the start-to-end segment, which ends inside the CSS gradient line', () => {
            // The CSS line through this box is 438px long and the segment 310px: stops land at 14.6% and 85.4%.
            // expo’s web adapter paints 0% and 100% here, which is wider than the device.
            const css = linearGradientCss({ colors: ['a', 'b'], ...diagonal }, { width: 390, height: 200 });
            const [, first, second] = /, a ([\d.]+)%, b ([\d.]+)%\)$/u.exec(css) ?? [];

            expect(Number(first)).toBeCloseTo(14.6, 1);
            expect(Number(second)).toBeCloseTo(85.4, 1);
        });

        it('is the same wash at any size for a corner-to-corner segment of a square', () => {
            expect(
                linearGradientCss({ colors: ['a', 'b'], start: [0, 0], end: [1, 1] }, { width: 80, height: 80 }),
            ).toBe('linear-gradient(135deg, a 0%, b 100%)');
        });
    });

    it.each([[0xff0000], [{ semantic: 'x' }], [null]])(
        'throws unknown-colour for the non-string colour %j',
        (colour) => {
            let thrown: unknown;

            try {
                linearGradientCss({ colors: ['#000', colour as never] }, SQUARE);
            } catch (error) {
                thrown = error;
            }

            expect(isDesignArtifactError(thrown)).toBe(true);
            expect(thrown).toMatchObject({ code: 'unknown-colour' });
        },
    );
});
