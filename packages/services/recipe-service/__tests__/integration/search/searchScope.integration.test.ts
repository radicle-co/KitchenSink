/**
 * `GET /api/v1/search/recipes?scope=community` over the REAL HTTP pipeline, its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` with the search DAL doubled. It proves what the unit tier
 * cannot: that the published query schema admits `scope`, that the controller hands it through the service to the
 * DAL, and that an unknown scope is a `400` that never reaches the DAL. The SQL itself is the LOCAL e2e tier's
 * (`tests/e2e/searchScope.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { RecipeSearchDalResult, RecipeSearchFilters } from '../../../src/search/dal/search.dal.js';
import { SEARCH_DAL } from '../../../src/search/search.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JSEARCHSCOPECOOK0000001';

let food: FoodFake;
let booted: BootedServiceApp;

/** The search DAL double: an empty page, recording the filters it was handed. */
const search = vi.fn(async (_filters: RecipeSearchFilters): Promise<RecipeSearchDalResult> => ({
    results: [],
    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
    total: 0,
}));

/**
 * Search as the cook with a raw query string.
 *
 * @sideEffect One HTTP request.
 */
async function searchWith(queryString: string): Promise<Response> {
    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/search/recipes?${queryString}`, {
            headers: { authorization: bearerFor(COOK) },
        }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: SEARCH_DAL, useValue: { search } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    search.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/search/recipes — scope (integration: real pipeline, mocked dependencies)', () => {
    it("hands scope 'community' and the caller's own id to the DAL", async () => {
        const res = await searchWith('scope=community');

        expect(res.status).toBe(200);
        expect(search.mock.calls[0]?.[0]).toMatchObject({ scope: 'community', ownerId: COOK });
    });

    it('hands the DAL no scope when the request carries none', async () => {
        const res = await searchWith('query=pasta');

        expect(res.status).toBe(200);
        expect(search.mock.calls[0]?.[0]).not.toHaveProperty('scope');
    });

    it('refuses an unknown scope with a 400 and never reaches the DAL', async () => {
        const res = await searchWith('scope=everyone');

        expect(res.status).toBe(400);
        expect(search).not.toHaveBeenCalled();
    });
});
