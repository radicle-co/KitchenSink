/**
 * The web routes of the nav destinations, and `tabRootOf`: for every route, which tab it belongs to and whether it IS
 * that tab's root (blueprint slice 3 step 6). A second tap on the active tab navigates to the root from a pushed route
 * and scrolls to the top at the root (`buildSpec.md` §3.2); this table is what decides which.
 */
import { describe, expect, it } from 'vitest';

import { homeNavHref, tabRootOf } from '../navHref';

describe('homeNavHref', () => {
    it.each([
        ['home', '/en'],
        ['recipes', '/en/recipes'],
        ['discover', '/en/discover'],
    ] as const)('routes %s to %s', (id, href) => {
        expect(homeNavHref(id, 'en')).toBe(href);
    });

    it('has no route for an unshipped destination', () => {
        expect(homeNavHref('meal-plan', 'en')).toBeUndefined();
        expect(homeNavHref('grocery', 'en')).toBeUndefined();
    });
});

describe('tabRootOf', () => {
    const cases: readonly (readonly [string, ReturnType<typeof tabRootOf>])[] = [
        ['/en', { tab: 'home', atRoot: true }],
        ['/en/', { tab: 'home', atRoot: true }],
        ['/en/recipes', { tab: 'recipes', atRoot: true }],
        // Collections is the Recipes tab's second segment: a root, not a pushed screen.
        ['/en/collections', { tab: 'recipes', atRoot: true }],
        ['/en/recipes/01HX', { tab: 'recipes', atRoot: false }],
        ['/en/recipes/01HX/versions', { tab: 'recipes', atRoot: false }],
        ['/en/recipes/new', { tab: 'recipes', atRoot: false }],
        ['/en/recipes/01HX/edit', { tab: 'recipes', atRoot: false }],
        ['/en/recipes/parse', { tab: 'recipes', atRoot: false }],
        ['/en/collections/01HY', { tab: 'recipes', atRoot: false }],
        ['/en/discover', { tab: 'discover', atRoot: true }],
        // Profile and legal open from the avatar, pushed onto whatever tab was current: on web, Home owns them.
        ['/en/profile', { tab: null, atRoot: false }],
        ['/en/legal/sources', { tab: null, atRoot: false }],
        ['/en/no-such-page', { tab: null, atRoot: false }],
    ];

    it.each(cases)('%s', (pathname, expected) => {
        expect(tabRootOf(pathname, 'en')).toStrictEqual(expected);
    });

    it('reads a preview base path and another locale', () => {
        expect(tabRootOf('/pr-91/de/recipes', 'de')).toStrictEqual({ tab: 'recipes', atRoot: true });
    });
});
