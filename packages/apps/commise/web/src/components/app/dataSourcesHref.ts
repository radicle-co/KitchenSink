/**
 * @module components/app/dataSourcesHref — where the Data sources page lives on web (curated U25, design §S16).
 *
 * The app, not the shared feature package, knows its own routes (`sourceTabHref` and `navHref` hold the same rule for
 * theirs). The page is linked from more than one surface, so every web link to it takes its address from here.
 */
import type { Route } from 'next';

/**
 * The Data sources page for a locale. Pure.
 *
 * @param locale - The active route locale.
 * @returns The locale-prefixed route.
 */
export function dataSourcesHref(locale: string): Route {
    return `/${locale}/legal/sources` as Route;
}
