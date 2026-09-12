/**
 * Media heights (`docs/design/compactHeightLayout.md` §8): one media box may take at most 40% of the window's height,
 * at every size. The hero keeps its width and crops; the photo strip keeps 4:3 and narrows.
 */
import { describe, expect, it } from 'vitest';

import { MEDIA_MAX_WINDOW_FRACTION, carouselBox, mediaBoxHeight } from '../mediaBox.js';

describe('mediaBoxHeight', () => {
    it('caps a box at 40% of the window height', () => {
        expect(MEDIA_MAX_WINDOW_FRACTION).toBe(0.4);
    });

    it.each([
        [256, 851, 256, 'the hero on a Pixel 5 upright: unchanged'],
        [256, 393, 157, 'the hero on a Pixel 5 sideways'],
        [256, 820, 256, 'the hero on an iPad sideways'],
        [96, 393, 96, 'the no-cover placeholder never binds'],
    ])('preferred %d in a %d window → %d (%s)', (preferred, windowHeight, height) => {
        expect(mediaBoxHeight(preferred, windowHeight)).toBe(height);
    });
});

describe('carouselBox', () => {
    it.each([
        [361, 851, { width: 361, height: 271 }, 'a Pixel 5 upright: 4:3 at the strip width, unchanged'],
        [723, 393, { width: 209, height: 157 }, 'a Pixel 5 sideways: capped, and narrowed to keep 4:3'],
        [1148, 820, { width: 437, height: 328 }, 'an iPad sideways'],
    ])('strip %d in a %d window → %o (%s)', (availableWidth, windowHeight, box) => {
        expect(carouselBox(availableWidth, windowHeight)).toStrictEqual(box);
    });

    it('never widens past the strip it sits in', () => {
        const box = carouselBox(200, 2000);

        expect(box.width).toBeLessThanOrEqual(200);
    });
});
