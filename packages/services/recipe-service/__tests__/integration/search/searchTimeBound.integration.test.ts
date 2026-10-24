/**
 * `GET /api/v1/search/recipes?maxTotalTime=` over the REAL HTTP pipeline, its dependencies MOCKED
 * (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule` with the search DAL doubled. A-017: the time facet and
 * the time bounds treat a stored 0 as "no time stated". The SQL that enforces it is the LOCAL e2e tier's
 * (`tests/e2e/search/searchTimeFacet.e2e.test.ts`); this file proves the wire half — that the bound reaches the DAL
 * untouched (the service must not "help" by translating 0 itself) and that the DAL's buckets reach the response.
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

const COOK = '01JSEARCHTIMEBOUND0000001';

let food: FoodFake;
let booted: BootedServiceApp;

/** The search DAL double: an empty page whose facets hold only STATED-time buckets, recording the filters it got. */
const search = vi.fn(async (_filters: RecipeSearchFilters): Promise<RecipeSearchDalResult> => ({
    results: [],
    facets: {
        dietaryFlags: [],
        tags: [],
        cuisine: [],
        totalTime: [
            { value: '0-15', count: 2 },
            { value: '16-30', count: 1 },
        ],
    },
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

describe('GET /api/v1/search/recipes — time bounds (integration: real pipeline, mocked dependencies)', () => {
    it('hands the total-time bound to the DAL untouched', async () => {
        const res = await searchWith('maxTotalTime=30');

        expect(res.status).toBe(200);
        expect(search.mock.calls[0]?.[0]).toMatchObject({ maxTotalTime: 30 });
    });

    it('hands the prep and cook bounds to the DAL untouched', async () => {
        const res = await searchWith('maxPrepTime=15&maxCookTime=20');

        expect(res.status).toBe(200);
        expect(search.mock.calls[0]?.[0]).toMatchObject({ maxPrepTime: 15, maxCookTime: 20 });
    });

    it('answers the DAL buckets as the totalTime facet, with no untimed bucket', async () => {
        const res = await searchWith('maxTotalTime=30');
        const body = (await res.json()) as { facets: { totalTime: { value: string; count: number }[] } };

        expect(body.facets.totalTime).toEqual([
            { value: '0-15', count: 2 },
            { value: '16-30', count: 1 },
        ]);
    });
});
