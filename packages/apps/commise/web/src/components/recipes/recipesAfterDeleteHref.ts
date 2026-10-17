/**
 * Where a deleted recipe's page sends the cook (owner decision 2026-10-13, 4): My recipes, with a one-shot flag that has
 * the list say "Recipe deleted". The detail page cannot say it itself: every route mounts its own `AppShell`, so a
 * snackbar raised before the navigation dies with the page (`useAddressNotice`). The address and its reading live once.
 */

/** The query flag My recipes reads. */
export const RECIPE_DELETED_PARAM = 'deleted';

/**
 * The address a delete lands on.
 *
 * @param locale - The route locale.
 * @returns The path. Pure.
 */
export function recipesAfterDeleteHref(locale: string): string {
    return `/${locale}/recipes?${RECIPE_DELETED_PARAM}=1`;
}

/**
 * Whether the flag's value is the one a delete sets. A URL is the reader's to forge, so nothing else counts.
 *
 * @param value - The parameter's value.
 * @returns `true` for the delete's flag. Pure.
 */
export function arrivedAfterDelete(value: string): boolean {
    return value === '1';
}
