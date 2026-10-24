/**
 * The pinned bar's two display facts, derived once for both frame leaves (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md`
 * §7): the material shows as soon as the page has scrolled (`!atTop`), and the one-line title once the H1 is under the bar
 * (`condensed`). A page that does not scroll never leaves the top, so it never gains material (§5).
 *
 * Mutation lens: swap the two facts, or key the material on `condensed`, and the "scrolled, H1 still visible" row fails.
 */
import { describe, expect, it } from 'vitest';

import { barFactsOf } from '../barFacts.js';

describe('barFactsOf', () => {
    it.each([
        { name: 'top of the page', atTop: true, condensed: false, surfaceShown: false, titleShown: false },
        {
            name: 'scrolled, the H1 still visible',
            atTop: false,
            condensed: false,
            surfaceShown: true,
            titleShown: false,
        },
        { name: 'the H1 under the bar', atTop: false, condensed: true, surfaceShown: true, titleShown: true },
    ])('$name', ({ atTop, condensed, surfaceShown, titleShown }) => {
        expect(barFactsOf({ atTop, condensed })).toEqual({ surfaceShown, titleShown });
    });
});
