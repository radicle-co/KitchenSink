import { describe, expect, it } from 'vitest';

import { pinnedOverlayMaxHeight } from '../pinnedOverlayLimit.js';

/**
 * The open pinned bar and its panel end at half the window (designer D75 and rule B of
 * `docs/design/compactHeightLayout.md`, which counts the pinned top row). Native caps the frame holding both with this
 * number. The web class is proved by the component test, which would otherwise compare a literal with itself.
 */
describe('pinnedOverlayMaxHeight', () => {
    it.each([
        [844, 422],
        [667, 333],
        [375, 187],
        [0, 0],
    ])('is half of a window %s tall, rounded down: %s', (windowHeight, expected) => {
        expect(pinnedOverlayMaxHeight(windowHeight)).toBe(expected);
    });
});
