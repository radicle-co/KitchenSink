/**
 * `GET /api/v1/search/recipes?foodIds=…` — the food filter widened from a root to its live variants (curated plan U9;
 * R23) over the REAL HTTP pipeline, its dependencies MOCKED (`docs/CODING_STANDARDS.md` §7.1a): the real `AppModule`
 * with the search DAL doubled, and food faked at the network (`tests/support/foodFake.ts`), so the real food client
 * serializes, forwards the bearer and parses food's published root read.
 *
 * It proves what the unit tier cannot: that the bound is enforced by the published query schema, that the caller's
 * own credential reaches food, and that a food outage refuses the search instead of running a partial filter. The
 * SQL that matches a variant-bound line is the LOCAL e2e tier's (`tests/e2e/searchByFood.e2e.test.ts`).
 */
import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';

import { ErasureJobsDal } from '../../../src/account/dal/erasureJobs.dal.js';
import type { RecipeSearchDalResult, RecipeSearchFilters } from '../../../src/search/dal/search.dal.js';
import { MAX_SEARCH_FOOD_FILTERS } from '../../../src/search/search.schema.js';
import { SEARCH_DAL } from '../../../src/search/search.service.js';
import { asPrincipal } from '../../../tests/support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../../tests/support/foodFake.js';
import { bootMockedRecipeApp } from '../../../tests/support/mockedRecipeApp.js';

const COOK = '01JSEARCHFOODFILTERCOOK001';
const FLAT_PARTS = [{ attribute: 'cut', text: 'flat' }];

let food: FoodFake;
let booted: BootedServiceApp;

/** The search DAL double: an empty page, recording the filters it was handed. */
const search = vi.fn(async (_filters: RecipeSearchFilters): Promise<RecipeSearchDalResult> => ({
    results: [],
    facets: { dietaryFlags: [], tags: [], cuisine: [], totalTime: [] },
    total: 0,
}));

/** The requests food's API received, without the client's one-time `/health` skew probe. */
function foodApiRequests(): readonly (readonly [string, string | undefined])[] {
    return food.requests
        .filter((request) => request.path.startsWith('/api/'))
        .map((request) => [request.path, request.callerId] as const);
}

/**
 * Search as the cook, filtering on `foodIds`, forwarding the cook's bearer to food.
 *
 * @sideEffect One HTTP request.
 */
async function searchByFood(foodIds: readonly string[]): Promise<Response> {
    const query = foodIds.map((id) => `foodIds=${encodeURIComponent(id)}`).join('&');

    return asPrincipal(COOK, () =>
        fetch(`${booted.baseUrl}/api/v1/search/recipes?${query}`, { headers: { authorization: bearerFor(COOK) } }),
    );
}

beforeAll(async () => {
    food = await startFoodFake();
    food.foods.set('R-brisket', { name: 'Beef brisket', status: 'RESOLVED' });
    food.foods.set('V-flat', { name: null, status: 'RESOLVED', variantOf: { rootId: 'R-brisket', parts: FLAT_PARTS } });
    // A cut the seed retired: it still answers for its lines, but it is not one of the root's LIVE variants.
    food.foods.set('V-gone', {
        name: null,
        status: 'RESOLVED',
        retired: true,
        variantOf: { rootId: 'R-brisket', parts: [{ attribute: 'cut', text: 'point' }] },
    });
    food.foods.set('R-onion', { name: 'Onion', status: 'RESOLVED' });

    booted = await bootMockedRecipeApp({
        foodServiceUrl: food.origin,
        doubles: [
            { provide: SEARCH_DAL, useValue: { search } },
            { provide: ErasureJobsDal, useValue: { findActiveJob: async () => undefined } },
        ],
    });
});

afterEach(() => {
    food.down = false;
    food.requests.length = 0;
    search.mockClear();
});

afterAll(async () => {
    await booted?.close();
    await food?.close();
});

describe('GET /api/v1/search/recipes — the food filter (integration: real pipeline, mocked dependencies)', () => {
    it('expands each root to its LIVE variants, asked as the caller, and hands the DAL both arms', async () => {
        const res = await searchByFood(['R-brisket', 'R-onion']);

        expect(res.status).toBe(200);
        // One wave: the two reads are concurrent, so they arrive in either order.
        expect([...foodApiRequests()].sort()).toStrictEqual([
            ['/api/v1/foods/R-brisket', COOK],
            ['/api/v1/foods/R-onion', COOK],
        ]);
        expect(search.mock.calls[0]?.[0].foodFilter).toStrictEqual({
            rootIds: ['R-brisket', 'R-onion'],
            variantIds: ['V-flat'],
        });
    });

    it('a root food does not know still filters on its own lines — a definite answer naming no variant', async () => {
        const res = await searchByFood(['R-unknown']);

        expect(res.status).toBe(200);
        expect(search.mock.calls[0]?.[0].foodFilter).toStrictEqual({ rootIds: ['R-unknown'], variantIds: [] });
    });

    it(`⛔ refuses a filter of ${String(MAX_SEARCH_FOOD_FILTERS + 1)} roots with a 400, and asks food nothing`, async () => {
        const roots = Array.from({ length: MAX_SEARCH_FOOD_FILTERS + 1 }, (_, index) => `R-${String(index)}`);

        const res = await searchByFood(roots);
        const error = (await res.json()) as { code?: string };

        expect(res.status).toBe(400);
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(foodApiRequests()).toStrictEqual([]);
        expect(search).not.toHaveBeenCalled();
    });

    it(`admits exactly ${String(MAX_SEARCH_FOOD_FILTERS)} roots — the positive control for the bound`, async () => {
        const roots = Array.from({ length: MAX_SEARCH_FOOD_FILTERS }, (_, index) => `R-${String(index)}`);

        expect((await searchByFood(roots)).status).toBe(200);
    });

    it('⛔ answers 502 SOURCE_UNAVAILABLE when food is down, and runs NO search — never a partial filter', async () => {
        food.down = true;

        const res = await searchByFood(['R-brisket']);
        const error = (await res.json()) as { code?: string };

        expect(res.status).toBe(502);
        expect(error.code).toBe('SOURCE_UNAVAILABLE');
        expect(search).not.toHaveBeenCalled();
    });

    it('a search that names no food asks food nothing', async () => {
        const res = await asPrincipal(COOK, () =>
            fetch(`${booted.baseUrl}/api/v1/search/recipes?query=brisket`, {
                headers: { authorization: bearerFor(COOK) },
            }),
        );

        expect(res.status).toBe(200);
        expect(foodApiRequests()).toStrictEqual([]);
        expect(search.mock.calls[0]?.[0]).not.toHaveProperty('foodFilter');
    });
});
