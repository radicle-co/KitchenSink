/**
 * Discover's no-result rules (`docs/design/uiOverhaul/buildSpec.md` §4.4, §4.6): which of the three no-result states
 * applies, which tags the "Try one of these" row offers, and whether the browse view's cuisine row has enough behind it.
 * Each rule is asserted from both sides of its threshold.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_RECIPE_FILTERS } from '../../filters/model.js';
import { discoveryMessages } from '../messages.js';
import { noResultKindOf, noResultTitleOf, showsCuisineShortcuts, tryTheseTagsOf } from '../noResults.js';

describe('noResultKindOf', () => {
    it('is undefined when nothing narrows the search: that is an empty catalogue, not a no-match', () => {
        expect(noResultKindOf({ query: '', filters: EMPTY_RECIPE_FILTERS })).toBeUndefined();
        expect(noResultKindOf({ query: '   ', filters: EMPTY_RECIPE_FILTERS })).toBeUndefined();
    });

    it('is "query" for a term alone, "filters" for filters alone and "both" for both', () => {
        expect(noResultKindOf({ query: 'lamb', filters: EMPTY_RECIPE_FILTERS })).toBe('query');
        expect(noResultKindOf({ query: '', filters: { tags: ['quick'] } })).toBe('filters');
        expect(noResultKindOf({ query: 'lamb', filters: { tags: ['quick'] } })).toBe('both');
    });
});

describe('tryTheseTagsOf', () => {
    const tag = (value: string, count: number) => ({ value, count });

    it('offers the three most-used tags, most used first', () => {
        const tags = [tag('a', 2), tag('b', 9), tag('c', 5), tag('d', 7)];

        expect(tryTheseTagsOf(tags, [])).toEqual(['b', 'd', 'c']);
    });

    it('offers nothing when fewer than three tags remain', () => {
        expect(tryTheseTagsOf([tag('a', 2), tag('b', 9)], [])).toEqual([]);
    });

    it('leaves out a tag already applied, and then counts what remains', () => {
        const tags = [tag('a', 9), tag('b', 8), tag('c', 7), tag('d', 6)];

        expect(tryTheseTagsOf(tags, ['a'])).toEqual(['b', 'c', 'd']);
        expect(tryTheseTagsOf(tags, ['a', 'b'])).toEqual([]);
    });

    it('treats an absent facet as no tags, and skips a tag with no recipes', () => {
        expect(tryTheseTagsOf(undefined, [])).toEqual([]);
        expect(tryTheseTagsOf([tag('a', 0), tag('b', 3), tag('c', 2)], [])).toEqual([]);
    });
});

describe('showsCuisineShortcuts', () => {
    const cuisine = (value: string, count: number) => ({ value, count });

    it('shows the row once three cuisines each hold three or more recipes', () => {
        expect(showsCuisineShortcuts([cuisine('a', 3), cuisine('b', 4), cuisine('c', 3)])).toBe(true);
    });

    it('hides it while only two cuisines reach three recipes', () => {
        expect(showsCuisineShortcuts([cuisine('a', 3), cuisine('b', 9), cuisine('c', 2), cuisine('d', 1)])).toBe(false);
    });

    it('hides it for no cuisines at all', () => {
        expect(showsCuisineShortcuts([])).toBe(false);
        expect(showsCuisineShortcuts(undefined)).toBe(false);
    });
});

describe('noResultTitleOf', () => {
    const copy = discoveryMessages.en;

    it('names the term for a search, the filters for filters, both for both, and the catalogue when nothing narrowed', () => {
        expect(noResultTitleOf('query', ' lamb ', copy)).toBe('No recipes for “lamb”');
        expect(noResultTitleOf('filters', '', copy)).toBe('No recipes match these filters');
        expect(noResultTitleOf('both', 'lamb', copy)).toBe('No recipes for “lamb” with these filters');
        expect(noResultTitleOf(undefined, '', copy)).toBe('No public recipes yet.');
    });
});
