/**
 * The reference-check adapter (plan U18, R22) — `FoodReferenceCheck` over
 * `@kitchensink/recipe-service-client`.
 *
 * DESIGN PATTERN: Port + Adapter, the mirror image of recipe-service's `FoodServiceClients.factory`: the
 * CALLER's own bearer is forwarded per request (there is no service token to inject), so a per-call
 * client is constructed rather than a singleton — the recipe service authorizes the read as the deleting
 * user, which is exactly the authority the response's `ownRecipeIds` is scoped to.
 *
 * Absent `RECIPE_SERVICE_URL` ⇒ the factory returns `undefined` and `FoodsService.deleteAuthored` fails
 * CLOSED with `503 REFERENCE_CHECK_UNAVAILABLE` — see the env schema's note on why this is optional.
 */
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import type { FoodReferenceCheck } from './foods.service.js';

/**
 * Build the check over the configured recipe origin.
 *
 * @param recipeServiceUrl - `RECIPE_SERVICE_URL`, or `undefined` when unconfigured.
 * @returns The port, or `undefined` (the caller fails closed).
 */
export function createRecipeReferenceCheck(recipeServiceUrl: string | undefined): FoodReferenceCheck | undefined {
    if (recipeServiceUrl === undefined) {
        return undefined;
    }

    return {
        async references(foodId: string, callerBearer: string) {
            const client = new RecipeServiceClient({ baseUrl: recipeServiceUrl, token: callerBearer });
            const response = await client.getFoodReferences(foodId);

            return { total: response.total, ownRecipeIds: response.ownRecipeIds };
        },
    };
}
