/**
 * @module lib/recipeRouteId — the recipe routes' id boundary. `/recipes/[id]` (and its `/edit` and `/versions`) answer
 * only for a recipe id, and a recipe id is a UUID: the recipe-service contract's own shape for one
 * (`addRecipeToCollectionRequestSchema.recipeId`; the service's routes take `ParseUUIDPipe`). Anything else in that
 * segment — `/recipes/parse`, a typo, a `local:` reference — is not a recipe.
 *
 * Applied twice, for two different reasons:
 * - the MIDDLEWARE rewrites such a path to one no route matches ({@link notARecipeRewrite}), so the app's global
 *   not-found answers 404 in the first HTML. A page's own `notFound()` cannot: every page sits inside
 *   `[locale]/loading.tsx`'s Suspense boundary, so the shell has gone out with a 200 before the page body runs.
 * - each PAGE refuses a non-id ({@link isRecipeRouteId}) before auth and before its prefetch, so no request ever leaves
 *   for a segment that is not an id, whatever reaches the page.
 *
 * Pure; it runs in the Edge middleware on every request, so it reads zod's own UUID pattern — the one the contract's
 * `z.uuid()` applies — rather than importing the recipe contract, which added 76 KB to the middleware bundle (measured
 * on a production build: 362 KB → 438 KB, against 0.5 KB for the pattern). `__tests__/recipeRouteId.test.ts` holds
 * the two to the same answers, so a change to the contract's id shape fails there instead of drifting.
 */
import { regexes } from 'zod/v4/core';

/** The pattern the contract's recipe id (`z.uuid()`) is checked against. */
const RECIPE_ID_PATTERN = regexes.uuid();

/**
 * The static routes under `/recipes`, which outrank `[id]`, as paths relative to it. The middleware cannot read the app
 * directory, so they are named here — and `__tests__/recipeRouteId.test.ts` pins this set to the directory, both ways.
 */
export const RECIPES_STATIC_ROUTES: ReadonlySet<string> = new Set(['new']);

/** Where a path that names no recipe is rewritten: a private (`_`) segment, which no route can be. */
const NOT_A_RECIPE_SEGMENT = '_not-a-recipe';

/**
 * @param segment - The `[id]` route segment.
 * @returns Whether it is a recipe id. Pure.
 */
export function isRecipeRouteId(segment: string): boolean {
    return RECIPE_ID_PATTERN.test(segment);
}

/**
 * @param pathname - A locale-prefixed pathname (`/{locale}/…`), without the basePath.
 * @returns The pathname to rewrite to when it is a recipe route whose `[id]` is not a recipe id, else `undefined`.
 *     Pure.
 */
export function notARecipeRewrite(pathname: string): string | undefined {
    const [locale, section, ...rest] = pathname.split('/').filter((segment) => segment !== '');

    if (locale === undefined || section !== 'recipes' || rest.length === 0) {
        return undefined;
    }

    if (RECIPES_STATIC_ROUTES.has(rest.join('/'))) {
        return undefined;
    }

    const [segment = ''] = rest;

    return isRecipeRouteId(segment) ? undefined : `/${locale}/${NOT_A_RECIPE_SEGMENT}`;
}
