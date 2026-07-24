// @vitest-environment jsdom
/**
 * Contract test for the public `FakeRecipeServiceClient` seam (CP-6 T3): a REAL {@link RecipeServiceClient}
 * instance wired to a network-guard `fetch`, exported so consumer packages (web, mobile, `@commise/test-utils`)
 * get type-checked test doubles from one place instead of hand-building a partial `{ listRecipes }` object
 * and force-casting it `as unknown as RecipeServiceClient`.
 *
 * | Behavior pinned                                                                                       |
 * | ------------------------------------------------------------------------------------------------------ |
 * | `createFakeRecipeServiceClient()` returns a real `RecipeServiceClient` instance                         |
 * | an unstubbed method reaching the network rejects loudly with `NETWORK_GUARD_MESSAGE`                    |
 * | `vi.spyOn` over the returned instance is type-checked against the real method signature and is honored  |
 * | construction accepts optional `baseUrl` / `token` overrides without throwing                            |
 */
import { describe, expect, it, vi } from 'vitest';

import { RecipeServiceClient } from '../../client.js';
import { makePaginatedResponse, makeRecipe } from '../../__fixtures__/recipes.js';
import { NETWORK_GUARD_MESSAGE, createFakeRecipeServiceClient } from '../fakeClient.js';

describe('createFakeRecipeServiceClient', () => {
    it('returns a real RecipeServiceClient instance', () => {
        expect(createFakeRecipeServiceClient()).toBeInstanceOf(RecipeServiceClient);
    });

    it('rejects loudly with NETWORK_GUARD_MESSAGE when an unstubbed method reaches the network', async () => {
        const client = createFakeRecipeServiceClient();

        await expect(client.listRecipes()).rejects.toThrow(NETWORK_GUARD_MESSAGE);
    });

    it('honors a vi.spyOn stub over a real (type-checked) method signature', async () => {
        const client = createFakeRecipeServiceClient();
        const page = makePaginatedResponse([makeRecipe({ title: 'Weeknight Pasta' })]);
        vi.spyOn(client, 'listRecipes').mockResolvedValue(page);

        await expect(client.listRecipes()).resolves.toEqual(page);
    });

    it('accepts optional baseUrl/token overrides without throwing', () => {
        expect(() =>
            createFakeRecipeServiceClient({ baseUrl: 'https://custom.invalid', token: 'tok_custom' }),
        ).not.toThrow();
    });
});
