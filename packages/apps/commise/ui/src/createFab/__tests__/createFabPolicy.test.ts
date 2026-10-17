/**
 * The floating "New recipe" button's presentation rules, once for both platforms (buildSpec §3.4, blueprint slice 3
 * step 4). The full table: where it hides, where it shrinks to an icon, and where it keeps its label.
 */
import { describe, expect, it } from 'vitest';

import { FAB_HEIGHT_PX, FAB_RESERVED_BOTTOM_PX, fabPresentationOf, type FabInputs } from '../createFabPolicy.js';

const BASE: FabInputs = {
    viewportClass: 'compact',
    chrome: 'tabBar',
    scrollingDown: false,
    atTop: true,
    focused: false,
    keyboardOpen: false,
    firstRun: false,
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
        ['the first-run state hides it (its own start buttons take its place)', { firstRun: true }, 'hidden'],
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

describe('FAB_RESERVED_BOTTOM_PX', () => {
    it('is the button height plus 32, the padding the list under it reserves (SC 2.4.11)', () => {
        expect(FAB_HEIGHT_PX).toBe(56);
        expect(FAB_RESERVED_BOTTOM_PX).toBe(88);
    });
});
