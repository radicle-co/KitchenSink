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
    columnsKeepingMinOf,
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

// The ONE rule behind every "this many columns while each keeps its minimum width, else one" decision: the container width
// less the gaps, shared between the columns, per unit of CAPPED text scale. Its two callers are the compact tile grid (two
// columns, 160 pt each, no gap, which is the designer's 320 pt) and the recipe page's fact tiles (as many as there are
// tiles, 100 pt each, an 8 pt gap).
describe('columnsKeepingMinOf', () => {
    interface Rule {
        readonly columns: number;
        readonly minPerColumn: number;
        readonly gap?: number;
    }

    it.each<[string, number, number, Rule, number]>([
        // The boundary: the column is exactly its minimum, and a hair under it.
        ['exactly the minimum', 200, 1, { columns: 2, minPerColumn: 100 }, 2],
        ['a hair under', 199.99, 1, { columns: 2, minPerColumn: 100 }, 1],
        // The gap comes out BEFORE the split: 2 × 100 + 10 fits at 210 and not at 209.99.
        ['gap met', 210, 1, { columns: 2, minPerColumn: 100, gap: 10 }, 2],
        ['gap not met', 209.99, 1, { columns: 2, minPerColumn: 100, gap: 10 }, 1],
        // Text scale multiplies the minimum.
        ['scaled minimum met', 400, 2, { columns: 2, minPerColumn: 100 }, 2],
        ['scaled minimum missed', 399.99, 2, { columns: 2, minPerColumn: 100 }, 1],
        // Three across, the fact tiles' case: an 8 pt gap and 100 pt per unit of scale.
        ['three tiles at 1x', 316, 1, { columns: 3, minPerColumn: 100, gap: 8 }, 3],
        ['three tiles, one short', 315, 1, { columns: 3, minPerColumn: 100, gap: 8 }, 1],
        ['three tiles at 2x', 358, 2, { columns: 3, minPerColumn: 100, gap: 8 }, 1],
        ['two tiles at 1.5x', 358, 1.5, { columns: 2, minPerColumn: 100, gap: 8 }, 2],
        // One column has no gap to take out, and one is also the fallback.
        ['one column, narrow', 50, 1, { columns: 1, minPerColumn: 100 }, 1],
        // Nothing to lay out.
        ['no columns', 358, 1, { columns: 0, minPerColumn: 100 }, 0],
        ['negative columns', 358, 1, { columns: -1, minPerColumn: 100 }, 0],
    ])('%s: %d pt at %dx with %o is %d columns', (_name, width, scale, rule, expected) => {
        expect(columnsKeepingMinOf(width, scale, rule)).toBe(expected);
    });

    it('reads an unmeasured scale (zero or less) as 1x', () => {
        expect(columnsKeepingMinOf(200, 0, { columns: 2, minPerColumn: 100 })).toBe(2);
        expect(columnsKeepingMinOf(200, -1, { columns: 2, minPerColumn: 100 })).toBe(2);
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
