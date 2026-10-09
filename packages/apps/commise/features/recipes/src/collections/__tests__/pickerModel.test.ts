/**
 * The add-recipes picker's pure rules (`docs/design/uiOverhaul/buildSpec.md` §5.3; blueprint A15): the Done summary
 * is a SET DIFFERENCE between the members at open and the members now, never a count of presses, so on → off → on
 * reads as no change.
 */
import { describe, expect, it } from 'vitest';

import { collectionMessages } from '../messages.js';
import { doneLabelOf, doneSummaryOf, narrowByTitle } from '../pickerModel.js';

describe('doneSummaryOf', () => {
    it('counts recipes now in the collection that were not at open as added, and the reverse as removed', () => {
        expect(doneSummaryOf(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({ added: 2, removed: 1 });
    });

    it('reads on → off → on as no change', () => {
        expect(doneSummaryOf(['a'], ['a'])).toEqual({ added: 0, removed: 0 });
        expect(doneSummaryOf([], [])).toEqual({ added: 0, removed: 0 });
    });

    it('does not double count a repeated id', () => {
        expect(doneSummaryOf(['a'], ['a', 'b', 'b'])).toEqual({ added: 1, removed: 0 });
    });
});

describe('doneLabelOf', () => {
    const copy = collectionMessages.en.picker;

    it('says Done alone when nothing changed', () => {
        expect(doneLabelOf({ added: 0, removed: 0 }, copy)).toBe('Done');
    });

    it('states what changed, leaving a zero part out', () => {
        expect(doneLabelOf({ added: 2, removed: 1 }, copy)).toBe('Done · 2 added, 1 removed');
        expect(doneLabelOf({ added: 2, removed: 0 }, copy)).toBe('Done · 2 added');
        expect(doneLabelOf({ added: 0, removed: 3 }, copy)).toBe('Done · 3 removed');
    });
});

describe('narrowByTitle', () => {
    const recipes = [{ title: 'Lemon Pasta' }, { title: 'Tomato Soup' }, { title: 'Pasta Bake' }];

    it('keeps the recipes whose title holds the term, in the order given, ignoring case and surrounding space', () => {
        expect(narrowByTitle(recipes, '  PASTA ')).toEqual([{ title: 'Lemon Pasta' }, { title: 'Pasta Bake' }]);
    });

    it('keeps them all for a blank term, and none when nothing matches', () => {
        expect(narrowByTitle(recipes, '   ')).toEqual(recipes);
        expect(narrowByTitle(recipes, 'zzz')).toEqual([]);
    });
});
