/**
 * The layer order of what draws inside one native window: the sheet engine's frame, and the snackbar above it.
 *
 * Tamagui's sheet frame carries a `zIndex` of its own, and a `zIndex` overrides sibling order. The snackbar's outlet
 * is the window's last child, but that did not keep it from being drawn under the frame (the snackbar was in the
 * accessibility tree and not on screen, found on an iPhone run of #221). So the order is a number, stated once.
 */
import { describe, expect, it } from 'vitest';

import { WINDOW_LAYERS } from '../windowLayers.js';

describe('WINDOW_LAYERS', () => {
    it('draws the snackbar above the sheet engine frame', () => {
        expect(WINDOW_LAYERS.snackbar).toBeGreaterThan(WINDOW_LAYERS.sheet);
    });
});
