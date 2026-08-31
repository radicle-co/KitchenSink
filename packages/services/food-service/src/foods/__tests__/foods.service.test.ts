/**
 * Unit tests for {@link FoodsService}'s local-store serve-rate instrumentation (T-199b, SC-004/SC-005).
 *
 * `getFood` is the ONLY path that can answer this question honestly: it is the golden-record read the
 * success criteria are written about, it makes no source call by construction, and it is the branch that
 * knows whether the local store had the answer. `getStatus` and `search` are deliberately NOT instrumented
 * — search never touches a source at all, so counting it would drive the rate to ~100% by construction and
 * destroy the signal; and the k6 SC-004 scenario measures `GET /api/v1/foods/{id}`, so instrumenting
 * anything wider would make the runtime metric and the load-test metric mean different things.
 *
 * The rest of `FoodsService` (dedup/enqueue/resolve/backpressure) is covered end-to-end by
 * `tests/foodsApi.integration.test.ts`; this suite pins the emission contract only.
 *
 * @implements SC-004 SC-005
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MIN_SEARCH_QUERY_LENGTH } from '@kitchensink/recipe-core/resolution/search-minimum';

import { FoodMetrics } from '../../observability/emfMetrics.js';
import type { FoodDao, FoodSourcesDao, FoodStatus, GoldenFoodRecord } from '../dao/index.js';
import type { FoodSearchDao } from '../dao/foodSearch.dao.js';
import { FoodsService } from '../foods.service.js';

const FOOD_ID = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';

/** A minimal golden record in `status`; enough for `toFoodResponse` to map it. */
function makeRecord(status: FoodStatus): GoldenFoodRecord {
    return {
        id: FOOD_ID,
        name: 'Broccoli, raw',
        description: null,
        kind: 'ingredient',
        status,
        nutrients: [],
        portions: [],
        sources: [],
        fieldProvenance: [],
    } as unknown as GoldenFoodRecord;
}

/** Build the service with only the collaborators `getFood` touches; the rest would fail loudly if used. */
function makeService(record: GoldenFoodRecord | null): {
    service: FoodsService;
    sink: ReturnType<typeof vi.fn>;
} {
    const foodDao = { readGoldenRecord: vi.fn().mockResolvedValue(record) } as unknown as FoodDao;
    const sink = vi.fn();
    const unused = undefined as unknown as never;
    const service = new FoodsService(
        foodDao,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        new FoodMetrics(sink),
    );

    return { service, sink };
}

/** The serve-rate observations emitted to `sink`, in order. */
function serveRateValues(sink: ReturnType<typeof vi.fn>): number[] {
    return sink.mock.calls
        .map((call) => JSON.parse(call[0] as string) as Record<string, unknown>)
        .filter((payload) => 'food-local-store-serve-rate' in payload)
        .map((payload) => payload['food-local-store-serve-rate'] as number);
}

describe('FoodsService.getFood — local-store serve rate (SC-004/SC-005)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('records a SERVED read (100) when the local store returns a RESOLVED golden record', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID);

        expect(serveRateValues(sink)).toEqual([100]);
    });

    it.each<FoodStatus>(['PENDING', 'UNRESOLVED'])(
        'records an UNSERVED read (0) for a %s food — the answer still needs a source fetch',
        async (status) => {
            const { service, sink } = makeService(makeRecord(status));

            await expect(service.getFood(FOOD_ID)).rejects.toThrow();
            expect(serveRateValues(sink)).toEqual([0]);
        },
    );

    it.each<FoodStatus>(['NOT_FOUND', 'FAILED'])('records an UNSERVED read (0) for a %s food', async (status) => {
        const { service, sink } = makeService(makeRecord(status));

        await expect(service.getFood(FOOD_ID)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('records an UNSERVED read (0) when no row exists at all', async () => {
        const { service, sink } = makeService(null);

        await expect(service.getFood(FOOD_ID)).rejects.toThrow();
        expect(serveRateValues(sink)).toEqual([0]);
    });

    it('emits exactly ONE observation per read (CloudWatch aggregates; the service must not double-count)', async () => {
        const { service, sink } = makeService(makeRecord('RESOLVED'));

        await service.getFood(FOOD_ID);
        await service.getFood(FOOD_ID);

        expect(serveRateValues(sink)).toEqual([100, 100]);
    });
});

/**
 * The FR-010a minimum, asserted at the SERVICE rather than only at the DAO (plan U37).
 *
 * ⛔ THE DAO GUARD IS NOT ENOUGH, and that is the whole point of this suite. `FoodsService.search` issues
 * THREE reads per call — the ranked statement plus two crosswalk lookups (`findFoodIdByBarcode`, then
 * `findFoodIdByExternalKey`) — and the crosswalks do not go through `FoodSearchDao` at all. A gate that
 * lived only in the DAO would still put two round trips on every keystroke of a query the product has ruled
 * unanswerable. FR-010a says the system returns no results; the cheapest way to return no results is to make
 * no query.
 *
 * Nothing is lost by skipping the crosswalks below the minimum: a GTIN is 8–14 digits and a USDA `fdcId` is
 * 4–7, so no identifier this branch can resolve is shorter than three characters.
 *
 * Mutation lens: every case fails if the gate is removed, if it is weakened back to "non-empty", if it is
 * moved below the crosswalk reads, or if the minimum stops being the shared one.
 */
describe('FoodsService.search — the FR-010a minimum (plan U37)', () => {
    /** Build the service with only the collaborators `search` touches, each recording its calls. */
    function makeSearchService(): {
        service: FoodsService;
        searchDao: { search: ReturnType<typeof vi.fn> };
        foodDao: { nutrientRowsFor: ReturnType<typeof vi.fn> };
        sources: { findFoodIdByBarcode: ReturnType<typeof vi.fn>; findFoodIdByExternalKey: ReturnType<typeof vi.fn> };
    } {
        const searchDao = { search: vi.fn().mockResolvedValue([]) };
        const foodDao = { nutrientRowsFor: vi.fn().mockResolvedValue([]) };
        const sources = {
            findFoodIdByBarcode: vi.fn().mockResolvedValue(undefined),
            findFoodIdByExternalKey: vi.fn().mockResolvedValue(undefined),
        };
        const unused = undefined as unknown as never;
        const service = new FoodsService(
            foodDao as unknown as FoodDao,
            unused,
            sources as unknown as FoodSourcesDao,
            searchDao as unknown as FoodSearchDao,
            unused,
            unused,
            unused,
            unused,
            unused,
            new FoodMetrics(vi.fn()),
        );

        return { service, searchDao, foodDao, sources };
    }

    describe('below the minimum, NOTHING is read', () => {
        it.each(['', ' ', 'e', 'eg', ' eg ', '  '])(
            'answers %j with an empty result set and no read',
            async (query) => {
                const { service, searchDao, sources } = makeSearchService();

                await expect(service.search(query)).resolves.toEqual({ results: [] });

                expect(searchDao.search).not.toHaveBeenCalled();
                // ⛔ The two reads a DAO-only gate would leave running on every keystroke.
                expect(sources.findFoodIdByBarcode).not.toHaveBeenCalled();
                expect(sources.findFoodIdByExternalKey).not.toHaveBeenCalled();
            },
        );

        it('refuses everything shorter than the shared minimum, whatever that minimum is', async () => {
            const { service, searchDao } = makeSearchService();

            await service.search('a'.repeat(MIN_SEARCH_QUERY_LENGTH - 1));

            expect(searchDao.search).not.toHaveBeenCalled();
        });
    });

    describe("withNutrition — the lexical tier's enrichment flag (plan U4b)", () => {
        const HITS = [
            { id: 'F-1', name: 'Flour, wheat', score: 0.9 },
            { id: 'F-2', name: 'Carob flour', score: 0.6 },
        ];
        const ROWS = [
            { foodId: 'F-1', nutrient: 'Energy', unit: 'kcal', basis: 'per_100g', amount: 364 },
            { foodId: 'F-1', nutrient: 'Protein', unit: 'g', basis: 'per_100g', amount: 10 },
        ];

        it('enriches each hit with its per-100g projection through the ONE selection rule', async () => {
            const { service, searchDao, foodDao } = makeSearchService();
            searchDao.search.mockResolvedValue([...HITS]);
            foodDao.nutrientRowsFor.mockResolvedValue([...ROWS]);

            const response = await service.search('flour', true);

            expect(foodDao.nutrientRowsFor).toHaveBeenCalledWith(['F-1', 'F-2']);
            expect(response.results[0]).toMatchObject({ id: 'F-1', caloriesPer100g: 364, proteinGPer100g: 10 });
            // A food with no qualifying rows carries NO macro fields — absent, never zero.
            expect(response.results[1]).not.toHaveProperty('caloriesPer100g');
        });

        it('⛔ reads NOTHING extra on the default keystroke path — enrichment is strictly opt-in', async () => {
            const { service, searchDao, foodDao } = makeSearchService();
            searchDao.search.mockResolvedValue([...HITS]);

            await service.search('flour');

            expect(foodDao.nutrientRowsFor).not.toHaveBeenCalled();
        });

        it('an empty hit set never issues the nutrient read', async () => {
            const { service, foodDao } = makeSearchService();

            await service.search('flour', true);

            expect(foodDao.nutrientRowsFor).not.toHaveBeenCalled();
        });
    });

    describe('at and above the minimum, the full three-read path runs', () => {
        it.each(['egg', 'ham', 'rye', 'chicken breast'])('searches for %j', async (query) => {
            const { service, searchDao, sources } = makeSearchService();

            await service.search(query);

            // Without this the suite above would pass on a `search` that does nothing at all.
            expect(searchDao.search).toHaveBeenCalledWith(query);
            expect(sources.findFoodIdByBarcode).toHaveBeenCalledWith(query);
            expect(sources.findFoodIdByExternalKey).toHaveBeenCalledWith('usda', query);
        });

        it('still trims before measuring, so a padded three-character query is searched', async () => {
            const { service, searchDao } = makeSearchService();

            await service.search('  egg  ');

            expect(searchDao.search).toHaveBeenCalledWith('egg');
        });
    });
});
