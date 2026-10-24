/**
 * Tests for the pure recent-search history model (U7). This layer owns EVERY rule the feature promises —
 * newest-first ordering, case-insensitive de-duplication, the retention cap, blank rejection, and
 * defensive parsing of whatever is actually on disk — so both platform adapters and the hook above them
 * stay trivial.
 *
 * The mutation lens: each case pins one rule with a distinguishing assertion (order, casing, length,
 * identity), so weakening the normalizer — dropping the trim, comparing case-sensitively, capping off by
 * one, or trusting `JSON.parse` output — fails here rather than surfacing as a corrupt history later.
 */
import { describe, expect, it } from 'vitest';

import {
    MAX_RECENT_SEARCHES,
    addRecentSearch,
    mergeRecentSearches,
    parseRecentSearches,
    recentSearchesKeyFor,
    serializeRecentSearches,
} from '../recentSearches.js';

describe('addRecentSearch', () => {
    it('prepends the query, newest first', () => {
        expect(addRecentSearch(['pasta'], 'risotto')).toEqual(['risotto', 'pasta']);
    });

    it('trims surrounding whitespace before storing', () => {
        expect(addRecentSearch([], '  lamb tagine \n')).toEqual(['lamb tagine']);
    });

    it.each([[''], ['   '], ['\t\n']])('ignores a blank query (%j) — returning the list unchanged', (blank) => {
        const existing = ['pasta'];

        // Identity (not merely equality): a blank query must not even produce a new array, so nothing
        // downstream treats it as a change worth persisting.
        expect(addRecentSearch(existing, blank)).toBe(existing);
    });

    it('de-duplicates case-insensitively, moving the entry to the front with its NEW casing', () => {
        expect(addRecentSearch(['pasta', 'risotto'], 'PASTA')).toEqual(['PASTA', 'risotto']);
    });

    it('de-duplicates ignoring surrounding whitespace differences', () => {
        expect(addRecentSearch(['pasta'], ' pasta ')).toEqual(['pasta']);
    });

    it('caps the list at the retention limit, evicting the OLDEST entry', () => {
        const full = Array.from({ length: MAX_RECENT_SEARCHES }, (_unused, index) => `query-${index}`);

        const next = addRecentSearch(full, 'newest');

        expect(next).toHaveLength(MAX_RECENT_SEARCHES);
        expect(next[0]).toBe('newest');
        expect(next).not.toContain(`query-${MAX_RECENT_SEARCHES - 1}`);
        expect(next).toContain('query-0');
    });
});

describe('addRecentSearch — A-027: a partial query typed this session is replaced, not kept', () => {
    it('replaces the previous query of this session when the new one extends it ("r", then "rice")', () => {
        expect(addRecentSearch(['r', 'pasta'], 'rice', 'r')).toEqual(['rice', 'pasta']);
    });

    // Owner ruling 2026-10-18: deleting letters never rewrites a search the cook ran. Erasing "Risotto" one letter at a
    // time commits "Risott" at the first pause, and that used to replace "Risotto" (discoverRecentSearches on iOS).
    it('records nothing when the new one is shorter (the cook deleted a letter): the search they ran stays', () => {
        const existing = ['rice', 'pasta'];

        expect(addRecentSearch(existing, 'ric', 'rice')).toBe(existing);
        expect(addRecentSearch(['Risotto'], 'Risott', 'Risotto')).toEqual(['Risotto']);
    });

    it('compares ignoring case and surrounding whitespace', () => {
        expect(addRecentSearch(['Ri', 'pasta'], ' RICE ', 'Ri')).toEqual(['RICE', 'pasta']);
    });

    it('keeps an unrelated previous query of this session', () => {
        expect(addRecentSearch(['pasta'], 'risotto', 'pasta')).toEqual(['risotto', 'pasta']);
    });

    it('keeps a prefix from an EARLIER session: with no previous query this session, nothing is replaced', () => {
        expect(addRecentSearch(['rice', 'pasta'], 'r', undefined)).toEqual(['r', 'rice', 'pasta']);
    });

    it('replaces only the previous query, never an older entry that happens to share the prefix', () => {
        expect(addRecentSearch(['ri', 'rice', 'pasta'], 'rich', 'ri')).toEqual(['rich', 'rice', 'pasta']);
    });

    it('ignores a blank query without touching the list, whatever came before it', () => {
        const existing = ['r'];

        expect(addRecentSearch(existing, '  ', 'r')).toBe(existing);
    });
});

describe('mergeRecentSearches', () => {
    it('keeps the newer list in front of the older one', () => {
        expect(mergeRecentSearches(['risotto'], ['pasta', 'lamb'])).toEqual(['risotto', 'pasta', 'lamb']);
    });

    it('de-duplicates across both lists, case-insensitively, keeping the newer entry’s position + casing', () => {
        expect(mergeRecentSearches(['Pasta'], ['pasta', 'lamb'])).toEqual(['Pasta', 'lamb']);
    });

    it('caps the merged result', () => {
        const newer = Array.from({ length: MAX_RECENT_SEARCHES }, (_unused, index) => `new-${index}`);

        expect(mergeRecentSearches(newer, ['old'])).toHaveLength(MAX_RECENT_SEARCHES);
        expect(mergeRecentSearches(newer, ['old'])).not.toContain('old');
    });
});

describe('parseRecentSearches', () => {
    it('returns an empty list when nothing has been stored yet', () => {
        expect(parseRecentSearches(null)).toEqual([]);
    });

    it.each([['not json at all'], ['{"queries":[]}'], ['42'], ['"pasta"'], ['null']])(
        'returns an empty list for a payload that is not an array of queries (%j)',
        (raw) => {
            expect(parseRecentSearches(raw)).toEqual([]);
        },
    );

    it('drops non-string and blank entries from a stored array', () => {
        expect(parseRecentSearches(JSON.stringify(['pasta', 42, null, '   ', { q: 'x' }, 'lamb']))).toEqual([
            'pasta',
            'lamb',
        ]);
    });

    it('normalizes a stored payload that is over the cap or holds duplicates', () => {
        const raw = JSON.stringify([
            'pasta',
            'PASTA',
            ...Array.from({ length: MAX_RECENT_SEARCHES }, (_unused, index) => `query-${index}`),
        ]);

        const parsed = parseRecentSearches(raw);

        expect(parsed).toHaveLength(MAX_RECENT_SEARCHES);
        expect(parsed[0]).toBe('pasta');
        expect(parsed.filter((query) => query.toLowerCase() === 'pasta')).toHaveLength(1);
    });

    it('round-trips a serialized list', () => {
        const queries = ['risotto', 'pasta', 'lamb tagine'];

        expect(parseRecentSearches(serializeRecentSearches(queries))).toEqual(queries);
    });
});

/** Owner ruling 2026-10-17 (`docs/design/uiOverhaul/ownerDecisions.md`): the history is kept per signed-in user. */
describe('recentSearchesKeyFor', () => {
    it('gives each user their own key, so one user can never read another`s history', () => {
        expect(recentSearchesKeyFor('user_a')).not.toBe(recentSearchesKeyFor('user_b'));
        expect(recentSearchesKeyFor('user_a')).toContain('user_a');
    });

    it('is stable for the same user (a reload reads what the last visit wrote)', () => {
        expect(recentSearchesKeyFor('user_a')).toBe(recentSearchesKeyFor('user_a'));
    });

    it('⛔ is not the unscoped key the history used before the ruling, which is never read again', () => {
        expect(recentSearchesKeyFor('user_a')).not.toBe('commise.recipes.recentSearches.v1');
        expect(recentSearchesKeyFor('v1')).not.toBe('commise.recipes.recentSearches.v1');
    });
});
