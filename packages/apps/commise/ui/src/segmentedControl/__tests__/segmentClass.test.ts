import { describe, expect, it } from 'vitest';

import { routeSegmentClass, segmentClass } from '../segmentClass.js';

/**
 * A segment's pill is 36 px inside the track's 4 px padding and taps across the track's whole 44 px through a
 * transparent overlay. The pill carries a 1 px border, and an absolutely placed overlay is offset from the PADDING box,
 * inside that border: `-inset-y-1` (4 px) therefore reached only 36 - 2 + 8 = 42 px, and a browser measured 43
 * (`recipeHomeResponsive.spec.ts`, "tapping the Collections segment sits AT the 44px floor"). The overlay must reach
 * past the border as well: 4 px of padding + 1 px of border. Mutation lens: restore `-inset-y-1` and both rows fail.
 */
describe('a segment’s tap overlay', () => {
    it.each([
        ['a view segment', segmentClass(false)],
        ['the current view segment', segmentClass(true)],
        ['a route segment', routeSegmentClass(false)],
        ['the current route segment', routeSegmentClass(true)],
    ])('%s reaches past the track padding and its own border', (_shape, classes) => {
        const tokens = classes.split(/\s+/u);

        expect(tokens).toContain('before:-inset-y-[5px]');
        expect(tokens).not.toContain('before:-inset-y-1');
    });
});
