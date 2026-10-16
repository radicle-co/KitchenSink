/**
 * The ONE definition of Home's recent-recipes read. Two readers must hit the same cache entry: the widget's read (web
 * and mobile) and Home's first-run check, which finds that entry by `recipeServiceKeys.recipeList`. A different key or
 * page size is a different entry, so the first-run check would silently read nothing.
 */
import { describe, expect, it, vi } from 'vitest';

import { recipeServiceKeys } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { RECENT_RECIPE_LIMIT } from '../recentRecipeLimit.js';
import { recentRecipesQuery } from '../recentRecipesQuery.js';

describe('recentRecipesQuery', () => {
    it('is cached under the key the first-run check reads', () => {
        const query = recentRecipesQuery(createFakeRecipeServiceClient());

        expect(query.queryKey).toEqual(recipeServiceKeys.recipeList({ pageSize: RECENT_RECIPE_LIMIT }));
    });

    it('reads one page of RECENT_RECIPE_LIMIT recipes', async () => {
        const client = createFakeRecipeServiceClient();
        const listRecipes = vi
            .spyOn(client, 'listRecipes')
            .mockResolvedValue({ data: [], total: 0, page: 1, pageSize: RECENT_RECIPE_LIMIT, hasMore: false });

        await recentRecipesQuery(client).queryFn?.({} as never);

        expect(listRecipes).toHaveBeenCalledTimes(1);
        expect(listRecipes.mock.calls[0]?.[0]).toMatchObject({ pageSize: RECENT_RECIPE_LIMIT });
    });
});
