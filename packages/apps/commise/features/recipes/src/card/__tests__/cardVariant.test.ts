/**
 * The card-variant policy (`docs/architecture/uiOverhaulBlueprint.md` Part C, slice 4): the SPACE a card gets picks its
 * variant, never the device (`docs/design/uiOverhaul/buildSpec.md` §4.1), and the owner's D8 ruling fixes Home's rule —
 * compact below a 960 px container, the full grid card from 960.
 *
 * Every combination is listed, so a change to one cell fails here rather than in a screen.
 */
import type { ContainerClass } from '@commise/ui/container-class';
import { describe, expect, it } from 'vitest';

import {
    LIST_VIEW_MODES,
    cardVariantOf,
    defaultViewModeOf,
    isListViewMode,
    type CardSurface,
    type CardVariant,
    type ListViewMode,
} from '../cardVariant.js';

describe('cardVariantOf', () => {
    it.each<[CardSurface, ContainerClass, ListViewMode, CardVariant]>([
        // Home (D8): compact below 960 whatever the view mode, the full card from 960.
        ['home', 'narrow', 'list', 'compact'],
        ['home', 'narrow', 'grid', 'compact'],
        ['home', 'regular', 'list', 'compact'],
        ['home', 'regular', 'grid', 'compact'],
        ['home', 'wide', 'list', 'grid'],
        ['home', 'wide', 'grid', 'grid'],
        // The library: the cook's list/grid choice, at every width.
        ['library', 'narrow', 'list', 'row'],
        ['library', 'narrow', 'grid', 'grid'],
        ['library', 'regular', 'list', 'row'],
        ['library', 'regular', 'grid', 'grid'],
        ['library', 'wide', 'list', 'row'],
        ['library', 'wide', 'grid', 'grid'],
        // Discover results (§4.5): compact 2-up below a 600 container, grid cards from 600.
        ['discover', 'narrow', 'list', 'compact'],
        ['discover', 'narrow', 'grid', 'compact'],
        ['discover', 'regular', 'list', 'grid'],
        ['discover', 'wide', 'grid', 'grid'],
    ])('%s at %s in %s view → %s', (surface, container, viewMode, expected) => {
        expect(cardVariantOf(container, viewMode, surface)).toBe(expected);
    });
});

describe('defaultViewModeOf', () => {
    // §4.3 "Default: list below 600, grid from 600."
    it.each<[ContainerClass, ListViewMode]>([
        ['narrow', 'list'],
        ['regular', 'grid'],
        ['wide', 'grid'],
    ])('%s → %s', (container, expected) => {
        expect(defaultViewModeOf(container)).toBe(expected);
    });
});

describe('isListViewMode', () => {
    it('accepts exactly the two stored modes', () => {
        expect(LIST_VIEW_MODES).toEqual(['list', 'grid']);

        for (const mode of LIST_VIEW_MODES) {
            expect(isListViewMode(mode)).toBe(true);
        }
    });

    it.each([undefined, null, '', 'List', 'rows', 'grid ', 0])(
        'refuses %j, so a stale or forged value is ignored',
        (value) => {
            expect(isListViewMode(value)).toBe(false);
        },
    );
});
