/**
 * @module components/app/shellSurfaces — the registry of shell-hosted SURFACES (web; L9 / FR-046).
 *
 * `AppShell`'s top bar names the surface the viewer is on. That name has to come from somewhere type-safe: the
 * shell-hosted routes are SERVER components with no locale context, so they cannot resolve localized copy
 * themselves, while `AppShell` (a client component) already owns the locale. Each route therefore passes an ID
 * from this closed union and the shell resolves the copy — the same shape `chrome.destinations` uses for nav
 * labels, and for the same reason: the copy is a `Record<ShellSurfaceId, string>`, so a surface added here
 * WITHOUT copy is a compile error rather than a blank top bar discovered in review.
 *
 * Surface ≠ nav destination. `HomeNavItemId` has one entry per nav ICON (all eleven recipe/collection routes
 * share `recipes`); a surface is one titled PAGE. Keeping them separate is what lets `/recipes/[id]/versions`
 * highlight the Recipes destination while titling itself "Version history".
 */

/**
 * Every surface the app shell hosts, in rough navigation order. Adding a shell route means adding an id here
 * (which then forces its localized title) — see `WebMessages['home']['chrome']['pageTitles']`.
 */
export const SHELL_SURFACE_IDS = [
    'home',
    'recipes',
    'recipeNew',
    'recipeDetail',
    'recipeEdit',
    'recipeCooking',
    'recipeVersions',
    'discover',
    'collections',
    'collectionNew',
    'collectionDetail',
    'collectionAddRecipes',
    'collectionRename',
    'profile',
    'account',
    'settings',
] as const;

/** One shell-hosted surface. */
export type ShellSurfaceId = (typeof SHELL_SURFACE_IDS)[number];

/**
 * The surface `AppShell` titles itself as when a caller passes no `titleId` — Home, which is exactly what the
 * top bar hard-coded before it became per-surface, so an un-migrated caller regresses nothing.
 */
export const DEFAULT_SHELL_SURFACE_ID: ShellSurfaceId = 'home';
