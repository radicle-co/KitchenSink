/**
 * How many columns a native card grid gets (`docs/design/uiOverhaul/buildSpec.md` §4.1–§4.2): native has no CSS
 * `auto-fill`, so the library grid's rule — columns of at least 240 points, as many as fit — is computed, and Home's
 * fixed grid (2 below a 600 container, 4 from 600, `homeCardsB.md` §2.2) is a lookup.
 */
import { describe, expect, it } from 'vitest';

import {
    COMPACT_COLUMN_MIN_WIDTH,
    HOME_COLUMNS,
    columnsOfVariant,
    compactColumnsOf,
    libraryGridColumnsOf,
} from '../cardGridLayout.js';

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

// Designer rule (2026-11-02, `designAnswers.md`): the phone grid shows two columns only while the container width divided by
// the CAPPED text scale is at least 320 pt, and one column below that, which keeps a tile title from breaking inside a word.
describe('compactColumnsOf', () => {
    it('names the designer’s 320 pt', () => {
        expect(COMPACT_COLUMN_MIN_WIDTH).toBe(320);
    });

    it.each<[number, number, number]>([
        // The boundary, at 1x and at the 2x cap.
        [320, 1, 2],
        [319.99, 1, 1],
        [640, 2, 2],
        [639.99, 2, 1],
        // The rule's own examples: 343 pt is two at 1x and one at 2x.
        [343, 1, 2],
        [343, 2, 1],
        [343, 1.5, 1],
        [343, 1.07, 2],
        // Wide containers stay two: the compact tile is never three-up.
        [1000, 1, 2],
        [1000, 2, 2],
    ])('a %d pt container at %dx text is %d columns', (width, scale, columns) => {
        expect(compactColumnsOf(width, scale)).toBe(columns);
    });

    it('never divides by an unmeasured scale: zero or less reads as 1x', () => {
        expect(compactColumnsOf(343, 0)).toBe(2);
    });
});

describe('columnsOfVariant', () => {
    // One rule for every native list of cards: a row is one column, the compact tile is Home\'s two while it fits (320 pt
    // a column at the capped scale), and a full card takes as many 240 columns as the container holds.
    it.each<['row' | 'grid' | 'compact', number, number, number]>([
        ['row', 358, 1, 1],
        ['row', 1000, 2, 1],
        ['compact', 358, 1, 2],
        ['compact', 358, 2, 1],
        ['grid', 358, 1, 1],
        ['grid', 720, 2, 2],
        ['grid', 960, 1, 3],
    ])('%s in %i pt at %dx text is %i columns', (variant, width, scale, columns) => {
        expect(columnsOfVariant(variant, width, scale)).toBe(columns);
    });
});
