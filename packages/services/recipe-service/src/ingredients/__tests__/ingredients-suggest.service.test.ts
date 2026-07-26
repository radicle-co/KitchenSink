/**
 * Stage 2 — unit tests for the two service operations the blended typeahead adds:
 * `IngredientsService.suggest` (the blend orchestration) and `IngredientsService.addByFoodId` (the pick +
 * F1 nutrition backfill).
 *
 * Kept in its own file rather than appended to `ingredients.service.test.ts` so the Stage-2 vertical's
 * contract reads as one story. The two properties this suite exists to prove — the ones a happy-path test
 * would silently pass while broken:
 *
 *  - **F2** — `suggest` NEVER surfaces a food-service failure and NEVER lets it suppress the recipe-local
 *    section; and the two reads are issued CONCURRENTLY, so food-service latency does not add to local latency.
 *  - **F1** — `addByFoodId` ends with the ingredient row carrying REAL nutrition, not NULL calories. Written
 *    to fail if the backfill write is dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoodResolutionStatus, RecipeErrorCode, isRecipeError } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/food-service-client';
import type { FoodServiceClient } from '@kitchensink/food-service-client';

import type { FoodCatalogGateway } from '../food-catalog.gateway.js';
import type { IngredientsDal } from '../dal/ingredients.dal.js';
import { IngredientsService } from '../ingredients.service.js';
import { makeFoodView, makeIngredient, makeStatusResult } from '../__fixtures__/ingredients.fixtures.js';

/** A fully mocked `IngredientsDal` (every method the Stage-2 paths may touch). */
function makeDal(): { dal: IngredientsDal; mocks: Record<string, ReturnType<typeof vi.fn>> } {
    const mocks = {
        search: vi.fn().mockResolvedValue([]),
        findById: vi.fn(),
        findByFoodId: vi.fn().mockResolvedValue(undefined),
        findByFoodIds: vi.fn().mockResolvedValue([]),
        findFreeformByName: vi.fn(),
        createFreeform: vi.fn(),
        createFoodBacked: vi.fn(),
        updateResolution: vi.fn(),
    };

    return { dal: mocks as unknown as IngredientsDal, mocks };
}

/** A mocked food client (only `getStatus` matters for the pick path). */
function makeFoodClient(): { client: FoodServiceClient; getStatus: ReturnType<typeof vi.fn> } {
    const getStatus = vi.fn();

    return { client: { getStatus } as unknown as FoodServiceClient, getStatus };
}

/** A mocked catalog gateway; defaults to "food-service answered with nothing". */
function makeCatalog(): { catalog: FoodCatalogGateway; search: ReturnType<typeof vi.fn> } {
    const search = vi.fn().mockResolvedValue({ hits: [], availability: 'ok' });

    return { catalog: { search } as unknown as FoodCatalogGateway, search };
}

describe('IngredientsService.suggest', () => {
    let dal: IngredientsDal;
    let mocks: Record<string, ReturnType<typeof vi.fn>>;
    let catalog: FoodCatalogGateway;
    let catalogSearch: ReturnType<typeof vi.fn>;
    let service: IngredientsService;

    beforeEach(() => {
        ({ dal, mocks } = makeDal());
        ({ catalog, search: catalogSearch } = makeCatalog());
        service = new IngredientsService(dal, makeFoodClient().client, catalog);
    });

    it('trims the query before it reaches EITHER catalog', async () => {
        await service.suggest('  chicken  ');

        expect(mocks['search']).toHaveBeenCalledWith('chicken', 10);
        expect(catalogSearch).toHaveBeenCalledWith('chicken', 10);
    });

    it('clamps the per-section limit the same way the local DAL does', async () => {
        await service.suggest('chicken', 999);

        expect(catalogSearch).toHaveBeenCalledWith('chicken', 50);
    });

    it('defaults the per-section limit when the caller supplies none', async () => {
        await service.suggest('chicken');

        expect(catalogSearch).toHaveBeenCalledWith('chicken', 10);
    });

    it('blends both catalogs into one sectioned envelope', async () => {
        const local = makeIngredient({ id: 'ing-1', name: 'My chicken' });
        mocks['search']!.mockResolvedValue([local]);
        catalogSearch.mockResolvedValue({
            hits: [{ foodId: 'food-1', name: 'Chicken breast, raw', score: 0.9 }],
            availability: 'ok',
        });

        const result = await service.suggest('chicken');

        expect(result).toEqual({
            suggestions: [
                { provenance: 'local', ingredient: local },
                { provenance: 'catalog', foodId: 'food-1', name: 'Chicken breast, raw', score: 0.9 },
            ],
            catalogAvailability: 'ok',
        });
    });

    it('issues the local and catalog reads CONCURRENTLY (food-service latency must not add to local)', async () => {
        const order: string[] = [];

        mocks['search']!.mockImplementation(async () => {
            order.push('local:start');
            await Promise.resolve();
            order.push('local:end');

            return [];
        });
        catalogSearch.mockImplementation(async () => {
            order.push('catalog:start');

            return { hits: [], availability: 'ok' };
        });

        await service.suggest('chicken');

        // The catalog read starts before the local read finishes — i.e. they overlap, they are not sequential.
        expect(order.indexOf('catalog:start')).toBeLessThan(order.indexOf('local:end'));
    });

    describe('dedup via the batch crosswalk', () => {
        it('only crosswalks catalog hits the local search did NOT already return', async () => {
            mocks['search']!.mockResolvedValue([makeIngredient({ id: 'ing-1', foodId: 'food-known' })]);
            catalogSearch.mockResolvedValue({
                hits: [
                    { foodId: 'food-known', name: 'Known', score: 0.9 },
                    { foodId: 'food-new', name: 'New', score: 0.8 },
                ],
                availability: 'ok',
            });

            await service.suggest('chicken');

            expect(mocks['findByFoodIds']).toHaveBeenCalledWith(['food-new']);
        });

        it('skips the crosswalk read entirely when there are no catalog hits', async () => {
            await service.suggest('chicken');

            expect(mocks['findByFoodIds']).not.toHaveBeenCalled();
        });

        it('promotes a crosswalked row into the local section instead of showing it as a catalog hit', async () => {
            const promoted = makeIngredient({ id: 'ing-9', name: 'Chicken breast', foodId: 'food-1' });
            mocks['findByFoodIds']!.mockResolvedValue([promoted]);
            catalogSearch.mockResolvedValue({
                hits: [{ foodId: 'food-1', name: 'Chicken breast, raw', score: 0.9 }],
                availability: 'ok',
            });

            const result = await service.suggest('chicken');

            expect(result.suggestions).toEqual([{ provenance: 'local', ingredient: promoted }]);
        });
    });

    describe('F2 — the local section always renders', () => {
        it('returns the local results and `unavailable` when the catalog degrades', async () => {
            const local = makeIngredient({ id: 'ing-1', name: 'My chicken' });
            mocks['search']!.mockResolvedValue([local]);
            catalogSearch.mockResolvedValue({ hits: [], availability: 'unavailable' });

            const result = await service.suggest('chicken');

            expect(result).toEqual({
                suggestions: [{ provenance: 'local', ingredient: local }],
                catalogAvailability: 'unavailable',
            });
        });

        it('propagates `disabled` distinctly from `unavailable` (an operator switch is not an error)', async () => {
            catalogSearch.mockResolvedValue({ hits: [], availability: 'disabled' });

            expect((await service.suggest('chicken')).catalogAvailability).toBe('disabled');
        });

        it('still degrades gracefully if the gateway itself rejects (belt AND braces)', async () => {
            const local = makeIngredient({ id: 'ing-1' });
            mocks['search']!.mockResolvedValue([local]);
            catalogSearch.mockRejectedValue(new Error('gateway contract violated'));

            const result = await service.suggest('chicken');

            expect(result.suggestions).toEqual([{ provenance: 'local', ingredient: local }]);
            expect(result.catalogAvailability).toBe('unavailable');
        });

        it('does NOT swallow a local database failure — the local section is the floor, not optional', async () => {
            mocks['search']!.mockRejectedValue(new Error('db down'));

            await expect(service.suggest('chicken')).rejects.toThrow('db down');
        });
    });
});

describe('IngredientsService.addByFoodId', () => {
    const FOOD_ID = '01J0000000000000000000FOOD';

    let dal: IngredientsDal;
    let mocks: Record<string, ReturnType<typeof vi.fn>>;
    let getStatus: ReturnType<typeof vi.fn>;
    let service: IngredientsService;

    beforeEach(() => {
        ({ dal, mocks } = makeDal());
        const food = makeFoodClient();
        getStatus = food.getStatus;
        service = new IngredientsService(dal, food.client, makeCatalog().catalog);
    });

    /** The seeded, already-RESOLVED golden record a Stage-2 catalog hit points at. */
    function resolvedStatus(): ReturnType<typeof makeStatusResult> {
        return makeStatusResult({
            id: FOOD_ID,
            status: FoodResolutionStatus.RESOLVED,
            food: makeFoodView({
                id: FOOD_ID,
                name: 'Chicken breast, raw',
                nutrients: [
                    { nutrient: 'Energy', amount: 165, unit: 'kcal', basis: 'per_100g', source: 'usda' },
                    { nutrient: 'Protein', amount: 31, unit: 'g', basis: 'per_100g', source: 'usda' },
                ],
                portions: [{ label: '1 cup chopped', gramWeight: 140, source: 'usda' }],
            }),
        });
    }

    describe('F1 — the pick MUST land with nutrition, never NULL calories', () => {
        it('creates the food-backed row and BACKFILLS nutrition + portions in one round-trip', async () => {
            getStatus.mockResolvedValue(resolvedStatus());
            const created = makeIngredient({
                id: 'ing-new',
                name: 'Chicken breast, raw',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            const backfilled = { ...created, caloriesPer100g: 165, proteinGPer100g: 31 };
            mocks['createFoodBacked']!.mockResolvedValue(created);
            mocks['updateResolution']!.mockResolvedValue(backfilled);

            const ingredient = await service.addByFoodId(FOOD_ID);

            // Exactly ONE cross-service read for the whole pick.
            expect(getStatus).toHaveBeenCalledTimes(1);
            expect(getStatus).toHaveBeenCalledWith(FOOD_ID);
            // The nutrition write actually happened, with the golden record's values.
            expect(mocks['updateResolution']).toHaveBeenCalledWith('ing-new', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                nutrition: {
                    caloriesPer100g: 165,
                    proteinGPer100g: 31,
                    carbsGPer100g: undefined,
                    fatGPer100g: undefined,
                },
                portions: [{ unit: 'cup', gramsPerUnit: 140 }],
            });
            // And the value handed back is the BACKFILLED row, not the nutrition-less one just created.
            expect(ingredient.caloriesPer100g).toBe(165);
        });

        it('takes the display name from FOOD-SERVICE, never from the caller (shared catalog integrity)', async () => {
            getStatus.mockResolvedValue(resolvedStatus());
            mocks['createFoodBacked']!.mockResolvedValue(makeIngredient({ id: 'ing-new' }));
            mocks['updateResolution']!.mockResolvedValue(makeIngredient({ id: 'ing-new' }));

            await service.addByFoodId(FOOD_ID);

            expect(mocks['createFoodBacked']).toHaveBeenCalledWith({
                name: 'Chicken breast, raw',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
        });

        it('backfills an EXISTING food-backed row that never got polled (self-healing, no duplicate row)', async () => {
            const stale = makeIngredient({
                id: 'ing-stale',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks['findByFoodId']!.mockResolvedValue(stale);
            getStatus.mockResolvedValue(resolvedStatus());
            mocks['updateResolution']!.mockResolvedValue({ ...stale, caloriesPer100g: 165 });

            const ingredient = await service.addByFoodId(FOOD_ID);

            expect(mocks['createFoodBacked']).not.toHaveBeenCalled();
            expect(ingredient.caloriesPer100g).toBe(165);
        });

        it('falls back to the created row when the backfill UPDATE matched nothing', async () => {
            getStatus.mockResolvedValue(resolvedStatus());
            const created = makeIngredient({ id: 'ing-new', foodId: FOOD_ID });
            mocks['createFoodBacked']!.mockResolvedValue(created);
            mocks['updateResolution']!.mockResolvedValue(undefined);

            expect(await service.addByFoodId(FOOD_ID)).toEqual(created);
        });
    });

    describe('short-circuit', () => {
        it('returns an already-resolved, already-nourished row WITHOUT any cross-service call', async () => {
            const settled = makeIngredient({
                id: 'ing-1',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 165,
            });
            mocks['findByFoodId']!.mockResolvedValue(settled);

            expect(await service.addByFoodId(FOOD_ID)).toEqual(settled);
            expect(getStatus).not.toHaveBeenCalled();
            expect(mocks['updateResolution']).not.toHaveBeenCalled();
        });

        it('does NOT short-circuit a RESOLVED row that is still missing nutrition', async () => {
            mocks['findByFoodId']!.mockResolvedValue(
                makeIngredient({ id: 'ing-1', foodId: FOOD_ID, foodResolutionStatus: FoodResolutionStatus.RESOLVED }),
            );
            getStatus.mockResolvedValue(resolvedStatus());
            mocks['updateResolution']!.mockResolvedValue(makeIngredient({ id: 'ing-1', caloriesPer100g: 165 }));

            expect((await service.addByFoodId(FOOD_ID)).caloriesPer100g).toBe(165);
            expect(getStatus).toHaveBeenCalledTimes(1);
        });

        it('trims the incoming food id', async () => {
            const settled = makeIngredient({
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 1,
            });
            mocks['findByFoodId']!.mockResolvedValue(settled);

            await service.addByFoodId(`  ${FOOD_ID}  `);

            expect(mocks['findByFoodId']).toHaveBeenCalledWith(FOOD_ID);
        });
    });

    describe('a food that cannot back an ingredient is rejected, never half-admitted', () => {
        it('rejects a PENDING food with no existing row — and writes NOTHING', async () => {
            getStatus.mockResolvedValue(makeStatusResult({ id: FOOD_ID, status: FoodResolutionStatus.PENDING }));

            await expect(service.addByFoodId(FOOD_ID)).rejects.toSatisfy(
                (error: unknown) => isRecipeError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT,
            );
            expect(mocks['createFoodBacked']).not.toHaveBeenCalled();
            expect(mocks['updateResolution']).not.toHaveBeenCalled();
        });

        it('rejects a RESOLVED food whose golden name is null (unnameable row)', async () => {
            getStatus.mockResolvedValue(
                makeStatusResult({
                    id: FOOD_ID,
                    status: FoodResolutionStatus.RESOLVED,
                    food: makeFoodView({ id: FOOD_ID, name: null }),
                }),
            );

            await expect(service.addByFoodId(FOOD_ID)).rejects.toSatisfy(
                (error: unknown) => isRecipeError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT,
            );
            expect(mocks['createFoodBacked']).not.toHaveBeenCalled();
        });

        it('rejects an unknown/terminal food id (food-service 404) with no existing row', async () => {
            getStatus.mockRejectedValue(new NotFoundError(FOOD_ID, 'NOT_FOUND'));

            await expect(service.addByFoodId(FOOD_ID)).rejects.toSatisfy(
                (error: unknown) => isRecipeError(error) && error.code === RecipeErrorCode.UNKNOWN_INGREDIENT,
            );
            expect(mocks['createFoodBacked']).not.toHaveBeenCalled();
        });

        it('advances an EXISTING row to the terminal status instead of throwing (freeform fallback stays open)', async () => {
            const existing = makeIngredient({
                id: 'ing-1',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks['findByFoodId']!.mockResolvedValue(existing);
            getStatus.mockRejectedValue(new NotFoundError(FOOD_ID, 'FAILED'));
            mocks['updateResolution']!.mockResolvedValue({
                ...existing,
                foodResolutionStatus: FoodResolutionStatus.FAILED,
            });

            const ingredient = await service.addByFoodId(FOOD_ID);

            expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.FAILED);
            expect(mocks['updateResolution']).toHaveBeenCalledWith('ing-1', {
                foodResolutionStatus: FoodResolutionStatus.FAILED,
            });
        });

        it('records a non-terminal status on an existing row when the food is still mid-resolution', async () => {
            const existing = makeIngredient({
                id: 'ing-1',
                foodId: FOOD_ID,
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            mocks['findByFoodId']!.mockResolvedValue(existing);
            getStatus.mockResolvedValue(makeStatusResult({ id: FOOD_ID, status: FoodResolutionStatus.UNRESOLVED }));
            mocks['updateResolution']!.mockResolvedValue({
                ...existing,
                foodResolutionStatus: FoodResolutionStatus.UNRESOLVED,
            });

            const ingredient = await service.addByFoodId(FOOD_ID);

            expect(ingredient.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        });

        it('propagates a non-404 food-service failure (a 5xx is not a client error)', async () => {
            getStatus.mockRejectedValue(new Error('food service exploded'));

            await expect(service.addByFoodId(FOOD_ID)).rejects.toThrow('food service exploded');
        });
    });
});
