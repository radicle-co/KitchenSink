/**
 * @module home/chrome/navHref — the web side of the shared nav model (`@commise/features-core` `homeNavigation.ts`):
 * each destination's route, and `tabRootOf`, which says which tab a route belongs to and whether it is that tab's root.
 * The second tap on the active tab reads it: from a pushed route it goes to the root, at the root it scrolls to the top
 * (`docs/design/uiOverhaul/buildSpec.md` §3.2).
 *
 * @pattern Registry — the route of each destination, and the tab of each route
 */
import type { HomeNavItemId } from '@commise/features-core';
import type { Route } from 'next';

/**
 * The web route for a destination, or `undefined` for one with no route yet (Plan, Shop).
 *
 * @param id - The destination.
 * @param locale - The active locale segment.
 * @returns The locale-prefixed route. Pure.
 */
export function homeNavHref(id: HomeNavItemId, locale: string): Route | undefined {
    switch (id) {
        case 'home':
            return `/${locale}` as Route;
        case 'recipes':
            return `/${locale}/recipes` as Route;
        case 'discover':
            return `/${locale}/discover` as Route;
        case 'meal-plan':
        case 'grocery':
            return undefined;
    }
}

/** Which tab a route belongs to, and whether it is that tab's root. */
export interface TabRoot {
    readonly tab: HomeNavItemId | null;
    readonly atRoot: boolean;
}

/** The first path segment after the locale → its tab, and the segments that are that tab's ROOTS. */
const TAB_OF_SEGMENT: Readonly<Record<string, HomeNavItemId>> = {
    recipes: 'recipes',
    collections: 'recipes',
    discover: 'discover',
};

/**
 * @param pathname - The current path, with or without a preview base path in front of the locale.
 * @param locale - The active locale segment.
 * @returns The route's tab (`null` for Profile, legal and the 404, which belong to no tab) and whether it is the root.
 *     Pure.
 */
export function tabRootOf(pathname: string, locale: string): TabRoot {
    const parts = pathname.split('/').filter((part) => part !== '');
    const afterLocale = parts.slice(parts.indexOf(locale) + 1);
    const [first, ...rest] = afterLocale;

    if (first === undefined) {
        return { tab: 'home', atRoot: true };
    }

    const tab = TAB_OF_SEGMENT[first];

    return tab === undefined ? { tab: null, atRoot: false } : { tab, atRoot: rest.length === 0 };
}
