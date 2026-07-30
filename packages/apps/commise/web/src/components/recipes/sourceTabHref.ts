/**
 * @module components/recipes/sourceTabHref — where each recipe SOURCE lives on web (L5).
 *
 * The two recipe sources are two routes: the caller's own library at `/{locale}/recipes` and the community
 * surface at `/{locale}/discover`. Both surfaces render the SAME shared `RecipeSourceTabs` switcher, so both
 * need the SAME destination pair — and the app, not the shared feature package, is what knows its own routes.
 * Single-sourced here so the two containers cannot disagree (which is how `/discover` ended up with no way
 * back to `/recipes` in the first place: each surface built its own idea of the switcher, and one of them
 * built half of it).
 *
 * Mirrors the `homeNavHref` module beside the app's nav chrome.
 */
import type { Route } from 'next';

import type { RecipeListTab } from '@commise/features-recipes';

/**
 * The destination for each recipe source, locale-prefixed. Pure.
 *
 * @param locale - The active route locale.
 * @returns Both sources' routes, keyed by source.
 */
export function recipeSourceHrefs(locale: string): Readonly<Record<RecipeListTab, Route>> {
    return {
        mine: `/${locale}/recipes` as Route,
        community: `/${locale}/discover` as Route,
    };
}
