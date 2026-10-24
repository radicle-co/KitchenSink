/**
 * How many columns a native card grid gets (`docs/design/uiOverhaul/buildSpec.md` §4.1–§4.2): native has no CSS
 * `auto-fill`, so the library grid's rule — columns of at least 240 points, as many as fit — is computed, and Home's
 * fixed grid (2 below a 600 container, 4 from 600, `homeCardsB.md` §2.2) is a lookup.
 */
import { describe, expect, it } from 'vitest';

import { HOME_COLUMNS, libraryGridColumnsOf } from '../cardGridLayout.js';

describe('libraryGridColumnsOf', () => {
    it.each<[number, number]>([
        [0, 1],
        [200, 1],
        [358, 1],
        // 2 × 240 + one 16 gap.
        [495, 1],
        [496, 2],
        [720, 2],
        [767, 3],
        [960, 3],
        [1440, 5],
    ])('a %i pt container holds %i columns of at least 240', (width, columns) => {
        expect(libraryGridColumnsOf(width)).toBe(columns);
    });
});

describe('HOME_COLUMNS', () => {
    it('is 2 × 2 below a 600 container and one row of 4 from 600', () => {
        expect(HOME_COLUMNS).toEqual({ narrow: 2, regular: 4, wide: 4 });
    });
});
