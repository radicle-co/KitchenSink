import { describe, expect, it } from 'vitest';

import { PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME, pinnedOverlayMaxHeight } from '../pinnedOverlayLimit.js';

/**
 * The open pinned bar and its panel end at half the window (designer D75 and rule B of
 * `docs/design/compactHeightLayout.md`, which counts the pinned top row). Native caps the frame holding both with this
 * number. The web class is pinned here as the exact text the rule gives (50dvh less the safe top inset and 0.5 rem),
 * so a different fraction or a dropped inset fails. The component test then proves the frame carries that class.
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

describe('PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME', () => {
    it('is half the dynamic viewport, less the safe top inset and the bar placement of 0.5 rem', () => {
        expect(PINNED_OVERLAY_WEB_MAX_HEIGHT_CLASS_NAME).toBe(
            'max-h-[calc(50dvh-env(safe-area-inset-top,0px)-0.5rem)]',
        );
    });
});
