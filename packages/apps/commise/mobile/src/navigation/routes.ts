/**
 * @module navigation/routes — the app's screens and their params, typed for React Navigation (ADR-0056; blueprint A6).
 * They replace the hand-made `RootDestination` union in `AppRoot` and the `Surface` stack union in the deleted
 * `RecipesScreen`: the same knowledge, now held by the navigator.
 *
 * - The ROOT stack holds the tabs and the focused tasks above them (the editor), so the tab bar hides on a task by
 *   construction.
 * - Each TAB is a stack. Its root differs; the pushed screens are the same in every tab, so Profile, a recipe or a
 *   collection opens on whichever tab the cook is in. All three stacks share one param list for that reason.
 *
 * @pattern Registry — the screens, keyed by route name, with their params
 */
import type { HomeNavItemId } from '@commise/features-core';
import type { EditorSectionId } from '@commise/features-recipes';
import type { NavigatorScreenParams } from '@react-navigation/native';

/** The screens every tab stack can push. */
export type PushedParamList = {
    RecipeDetail: { readonly recipeId: string };
    RecipeVersions: { readonly recipeId: string };
    CollectionDetail: { readonly collectionId: string };
    Profile: undefined;
};

/** A place in the Recipes tab's segments. */
export type RecipesSegment = 'mine' | 'collections';

/** The tab stacks' screens: each registers its own root and every pushed screen. */
export type TabStackParamList = PushedParamList & {
    HomeRoot: undefined;
    RecipesRoot: { readonly segment?: RecipesSegment } | undefined;
    DiscoverRoot: { readonly tags?: readonly string[] } | undefined;
};

/** The tabs, in bar order. */
export const TAB_ROUTES = ['home', 'recipes', 'discover'] as const satisfies readonly HomeNavItemId[];

/** A tab. */
export type TabRoute = (typeof TAB_ROUTES)[number];

/** The tab navigator's screens: one stack per tab. */
export type TabParamList = Record<TabRoute, NavigatorScreenParams<TabStackParamList> | undefined>;

/** The root stack: the tabs, then the focused tasks above them (the editor). */
export type RootStackParamList = {
    Tabs: NavigatorScreenParams<TabParamList> | undefined;
    /**
     * The one-page editor for a new recipe; `section` is a deep link's (blueprint A16). `paste` opens Paste a list at
     * once: Home's first-run Paste ingredients (build spec §7.5.4), which replaced the retired paste screens (slice 8).
     */
    RecipeCreate: { readonly section?: EditorSectionId; readonly paste?: boolean } | undefined;
    /** The one-page editor for a stored recipe. */
    RecipeEdit: { readonly recipeId: string; readonly section?: EditorSectionId };
};

/**
 * @param name - A route name from the tab navigator's state.
 * @returns Whether it names a tab. Pure.
 */
export function isTabRoute(name: string): name is TabRoute {
    return (TAB_ROUTES as readonly string[]).includes(name);
}
