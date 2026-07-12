import type { Recipe } from '@kitchensink/recipe-core';

/**
 * Recent recipes for the Home widget (server-side).
 *
 * recipe-service is not yet reachable from the web app's environment (`RECIPE_SERVICE_URL` is unset in
 * preview/prod today — its infra is not deployed), so this yields an empty list and the widget renders
 * its empty state rather than erroring. Once the service is reachable, wire the real
 * `@kitchensink/recipe-service-client` call here, passing the Clerk session token from
 * `auth().getToken()`. Kept as a single seam so the mount + E2E don't have to change when data lands.
 *
 * @sideEffect Network I/O once `RECIPE_SERVICE_URL` is set and the real client call is wired in.
 */
export async function fetchRecentRecipes(): Promise<readonly Recipe[]> {
    const baseUrl = process.env['RECIPE_SERVICE_URL'];

    if (!baseUrl) {
        return [];
    }

    // TODO(feature-001): call listRecipes via @kitchensink/recipe-service-client with the Clerk token.
    return [];
}
