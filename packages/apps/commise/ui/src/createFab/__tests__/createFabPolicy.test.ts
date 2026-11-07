/**
 * The floating "New recipe" button's presentation rules, once for both platforms (buildSpec §3.4, blueprint slice 3
 * step 4). The full table: where it hides, where it shrinks to an icon, and where it keeps its label.
 */
import { describe, expect, it } from 'vitest';

import { spacing } from '../../tokens/scale.js';
import {
    FAB_BOTTOM_MARGIN_PX,
    FAB_FLOATS_FROM_HEIGHT_PX,
    FAB_HEIGHT_PX,
    FAB_RESERVED_BOTTOM_PX,
    fabPresentationOf,
    fabHeightAt,
    fabReservedBottomOf,
    type FabInputs,
} from '../createFabPolicy.js';

const BASE: FabInputs = {
    viewportClass: 'compact',
    chrome: 'tabBar',
    scrollingDown: false,
    atTop: true,
    focused: false,
    keyboardOpen: false,
    yielded: false,
    labelWidthPx: 100,
    windowWidthPx: 390,
};

describe('fabPresentationOf', () => {
    const cases: readonly (readonly [string, Partial<FabInputs>, ReturnType<typeof fabPresentationOf>])[] = [
        ['a phone at the top of the page shows the label', {}, 'extended'],
        ['a phone scrolling down shrinks to the icon', { scrollingDown: true, atTop: false }, 'icon'],
        ['a phone scrolling up grows back', { scrollingDown: false, atTop: false }, 'extended'],
        ['a phone at the top grows back even mid-gesture', { scrollingDown: true, atTop: true }, 'extended'],
        ['focus grows it back while scrolling down', { scrollingDown: true, atTop: false, focused: true }, 'extended'],
        ['a tablet never shrinks', { viewportClass: 'medium', scrollingDown: true, atTop: false }, 'extended'],
        [
            'a wide native tablet (no sidebar) never shrinks',
            { viewportClass: 'expanded', scrollingDown: true, atTop: false },
            'extended',
        ],
        ['the sidebar holds New recipe, so there is no floating button', { chrome: 'sidebar' }, 'hidden'],
        ['the keyboard hides it', { keyboardOpen: true }, 'hidden'],
        [
            'yielding hides it (a first load in flight, or a first run whose own start buttons take its place)',
            { yielded: true },
            'hidden',
        ],
        ['a focused button that must yield stays until focus leaves', { yielded: true, focused: true }, 'extended'],
        [
            'a focused button that must yield keeps the icon form for an over-wide label',
            { yielded: true, focused: true, labelWidthPx: 196, windowWidthPx: 390 },
            'icon',
        ],
        ['the keyboard hides it even while it has focus', { keyboardOpen: true, focused: true }, 'hidden'],
        ['a label wider than half the window stays icon-only', { labelWidthPx: 196, windowWidthPx: 390 }, 'icon'],
        ['a label of exactly half the window still fits', { labelWidthPx: 195, windowWidthPx: 390 }, 'extended'],
        [
            'an over-wide label stays an icon on a tablet too',
            { viewportClass: 'medium', labelWidthPx: 400, windowWidthPx: 700 },
            'icon',
        ],
        ['hidden outranks the icon form', { keyboardOpen: true, labelWidthPx: 999 }, 'hidden'],
    ];

    it.each(cases)('%s', (_name, inputs, expected) => {
        expect(fabPresentationOf({ ...BASE, ...inputs })).toBe(expected);
    });
});

// REWRITTEN for the designer ruling of 2026-11-01, corrected (`nativeBoards/designAnswers.md`): a screen the button
// floats over ends with the button's height, the margin it rests at and 16, computed, not a fixed number. It was pinned
// as "the height plus 32", which hid the margin inside the 32. The value is unchanged.
describe('FAB_RESERVED_BOTTOM_PX', () => {
    it('rests the button 16 above the foot', () => {
        expect(FAB_BOTTOM_MARGIN_PX).toBe(spacing[4]);
    });

    it('is the button’s height, the margin it rests at, and 16 (SC 2.4.11)', () => {
        expect(FAB_HEIGHT_PX).toBe(56);
        expect(FAB_RESERVED_BOTTOM_PX).toBe(FAB_HEIGHT_PX + FAB_BOTTOM_MARGIN_PX + spacing[4]);
        expect(FAB_RESERVED_BOTTOM_PX).toBe(88);
    });
});

// Designer ruling d (mergedUiAndroid1.md): the end room is computed from the button's DRAWN height. The height rule
// (how the pill grows with the text scale) is pending the designer; the formula takes the height as an input.
describe('fabReservedBottomOf', () => {
    it('is the drawn height, the resting margin and 16', () => {
        expect(fabReservedBottomOf(56)).toBe(88);
        expect(fabReservedBottomOf(66)).toBe(98);
    });

    it('moves one for one with the height', () => {
        expect(fabReservedBottomOf(80) - fabReservedBottomOf(60)).toBe(20);
    });

    it('is the scale-1 constant at the 56 floor', () => {
        expect(FAB_RESERVED_BOTTOM_PX).toBe(fabReservedBottomOf(FAB_HEIGHT_PX));
    });
});

describe('fabHeightAt (designer rulings d and Q1/Q2, 2026-11-02)', () => {
    it('is the 56 floor at scale 1 and below', () => {
        expect(fabHeightAt(1)).toBe(56);
        expect(fabHeightAt(0.8)).toBe(56);
    });

    it('grows with the label: 56 + 20 x (scale - 1), so 66 at 1.5x and a 98 end room', () => {
        expect(fabHeightAt(1.25)).toBe(61);
        expect(fabHeightAt(1.5)).toBe(66);
        expect(fabReservedBottomOf(fabHeightAt(1.5))).toBe(98);
    });

    it('stops at the 1.5x chrome cap while the system scale goes on to 2x', () => {
        expect(fabHeightAt(2)).toBe(fabHeightAt(1.5));
    });
});

// Designer ruling, web only (designAnswers.md, 2026-11-02): below 400 CSS px of viewport height the New recipe button
// stops floating, because at 200 px the floating button and the tab bar leave 48 px of page. ONE constant names the
// threshold; the theme generates the media query and the variant from it, and nothing else spells 400.
describe('FAB_FLOATS_FROM_HEIGHT_PX', () => {
    it('is the 400 CSS px of viewport height from which the web button floats', () => {
        expect(FAB_FLOATS_FROM_HEIGHT_PX).toBe(400);
    });
});
