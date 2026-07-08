import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoodResolutionStatus, RecipeErrorCode, isRecipeError } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/food-service-client';
import type { FoodServiceClient } from '@kitchensink/food-service-client';

import type { IngredientsDal } from '../dal/ingredients.dal.js';
import { IngredientsService, extractNutrition } from '../ingredients.service.js';
import {
    makeAddResult,
    makeCandidateView,
    makeFoodView,
    makeIngredient,
    makeSearchResultView,
    makeStatusResult,
} from '../__fixtures__/ingredients.fixtures.js';

/** A fully mocked `IngredientsDal`. */
function makeDal(): { dal: IngredientsDal; mocks: Record<string, ReturnType<typeof vi.fn>> } {
    const mocks = {
        search: vi.fn(),
        findById: vi.fn(),
        findByFoodId: vi.fn(),
        findFreeformByName: vi.fn(),
        createFreeform: vi.fn(),
        createFoodBacked: vi.fn(),
        updateResolution: vi.fn(),
    };

    return { dal: mocks as unknown as IngredientsDal, mocks };
}

/** A fully mocked `FoodServiceClient`. */
function makeFoodClient(): { client: FoodServiceClient; mocks: Record<string, ReturnType<typeof vi.fn>> } {
    const mocks = {
        search: vi.fn(),
        addByName: vi.fn(),
        getById: vi.fn(),
        getStatus: vi.fn(),
        getCandidates: vi.fn(),
        resolve: vi.fn(),
        batch: vi.fn(),
    };

    return { client: mocks as unknown as FoodServiceClient, mocks };
}

describe('extractNutrition', () => {
    it('projects per-100g energy / protein / carbs / fat from a golden record', () => {
        const nutrition = extractNutrition(makeFoodView());

        expect(nutrition).toEqual({
            caloriesPer100g: 364,
            proteinGPer100g: 10.3,
            carbsGPer100g: 76.3,
            fatGPer100g: 0.98,
        });
    });

    it('leaves a missing nutrient undefined and ignores non-per_100g bases', () => {
        const nutrition = extractNutrition(
            makeFoodView({
                nutrients: [
                    { nutrient: 'Protein', amount: 5, unit: 'g', basis: 'per_serving', source: 'usda' },
                    { nutrient: 'Energy', amount: 200, unit: 'kcal', basis: 'per_100g', source: 'usda' },
                ],
            }),
        );

        expect(nutrition.caloriesPer100g).toBe(200);
        expect(nutrition.proteinGPer100g).toBeUndefined();
    });
});

describe('IngredientsService', () => {
    let service: IngredientsService;
    let dal: IngredientsDal;
    let dalMocks: Record<string, ReturnType<typeof vi.fn>>;
    let client: FoodServiceClient;
    let clientMocks: Record<string, ReturnType<typeof vi.fn>>;

    beforeEach(() => {
        ({ dal, mocks: dalMocks } = makeDal());
        ({ client, mocks: clientMocks } = makeFoodClient());
        service = new IngredientsService(dal, client);
    });

    describe('search (local catalog)', () => {
        it('delegates a trimmed query to the DAL and returns its rows', async () => {
            const rows = [makeIngredient({ id: 'a' })];
            dalMocks['search']!.mockResolvedValue(rows);

            const results = await service.search('  flour  ', 5);

            expect(dalMocks['search']).toHaveBeenCalledWith('flour', 5);
            expect(results).toBe(rows);
        });
    });

    describe('suggestFoods (typeahead over the food service)', () => {
        it('proxies foodClient.search and returns the ranked hits', async () => {
            const hit = makeSearchResultView();
            clientMocks['search']!.mockResolvedValue({ results: [hit] });

            const results = await service.suggestFoods('  flou  ');

            expect(clientMocks['search']).toHaveBeenCalledWith('flou');
            expect(results).toEqual([hit]);
        });
    });

    describe('addByName', () => {
        it('adds an unknown food (202 PENDING) and persists a new food-backed ingredient', async () => {
            clientMocks['addByName']!.mockResolvedValue(
                makeAddResult({ id: 'F1', status: FoodResolutionStatus.PENDING }),
            );
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            const created = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            dalMocks['createFoodBacked']!.mockResolvedValue(created);

            const result = await service.addByName('  Quinoa  ');

            expect(clientMocks['addByName']).toHaveBeenCalledWith('Quinoa');
            expect(dalMocks['createFoodBacked']).toHaveBeenCalledWith({
                name: 'Quinoa',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.PENDING,
            });
            expect(result).toBe(created);
        });

        it('dedups on food_id: returns the existing ingredient without re-inserting', async () => {
            clientMocks['addByName']!.mockResolvedValue(makeAddResult({ id: 'F1' }));
            const existing = makeIngredient({ id: 'dup', foodId: 'F1' });
            dalMocks['findByFoodId']!.mockResolvedValue(existing);

            const result = await service.addByName('Quinoa');

            expect(result).toBe(existing);
            expect(dalMocks['createFoodBacked']).not.toHaveBeenCalled();
        });

        it('surfaces UNRESOLVED (needs disambiguation) as the persisted status', async () => {
            clientMocks['addByName']!.mockResolvedValue(
                makeAddResult({ id: 'F2', status: FoodResolutionStatus.UNRESOLVED }),
            );
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            dalMocks['createFoodBacked']!.mockImplementation((input: unknown) =>
                Promise.resolve(makeIngredient(input as object)),
            );

            const result = await service.addByName('Ambiguous thing');

            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.UNRESOLVED);
        });
    });

    describe('refreshStatus (poll)', () => {
        it('persists RESOLVED status + golden-record nutrition', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.PENDING }),
            );
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({ id: 'F1', status: FoodResolutionStatus.RESOLVED, food: makeFoodView() }),
            );
            const resolved = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                caloriesPer100g: 364,
            });
            dalMocks['updateResolution']!.mockResolvedValue(resolved);

            const result = await service.refreshStatus('i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                nutrition: { caloriesPer100g: 364, proteinGPer100g: 10.3, carbsGPer100g: 76.3, fatGPer100g: 0.98 },
            });
            expect(result).toBe(resolved);
        });

        it('advances a still-PENDING status with no nutrition write', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({ id: 'F1', status: FoodResolutionStatus.PENDING }),
            );
            dalMocks['updateResolution']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.PENDING }),
            );

            await service.refreshStatus('i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.PENDING,
                nutrition: undefined,
            });
        });

        it('records a terminal NOT_FOUND (client NotFoundError) instead of throwing', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));
            clientMocks['getStatus']!.mockRejectedValue(new NotFoundError('F1', FoodResolutionStatus.NOT_FOUND));
            dalMocks['updateResolution']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.NOT_FOUND }),
            );

            const result = await service.refreshStatus('i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
            });
            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
        });

        it('is a no-op for a freeform ingredient (no food reference)', async () => {
            const freeform = makeIngredient({ id: 'f1', isUserEntered: true });
            dalMocks['findById']!.mockResolvedValue(freeform);

            const result = await service.refreshStatus('f1');

            expect(result).toBe(freeform);
            expect(clientMocks['getStatus']).not.toHaveBeenCalled();
        });

        it('throws RECIPE_NOT_FOUND for an unknown ingredient id', async () => {
            dalMocks['findById']!.mockResolvedValue(undefined);

            await expect(service.refreshStatus('missing')).rejects.toSatisfy(
                (e: unknown) => isRecipeError(e) && e.code === RecipeErrorCode.RECIPE_NOT_FOUND,
            );
        });
    });

    describe('disambiguation', () => {
        it('getCandidates proxies the food client for a food-backed ingredient', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            const candidate = makeCandidateView();
            clientMocks['getCandidates']!.mockResolvedValue({ id: 'F1', candidates: [candidate] });

            const result = await service.getCandidates('i1');

            expect(clientMocks['getCandidates']).toHaveBeenCalledWith('F1');
            expect(result).toEqual([candidate]);
        });

        it('getCandidates returns empty for a freeform ingredient', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'f1', isUserEntered: true }));

            expect(await service.getCandidates('f1')).toEqual([]);
            expect(clientMocks['getCandidates']).not.toHaveBeenCalled();
        });

        it('resolve picks candidates then re-polls to persist resolved nutrition', async () => {
            dalMocks['findById']!.mockResolvedValue(
                makeIngredient({ id: 'i1', foodId: 'F1', foodResolutionStatus: FoodResolutionStatus.UNRESOLVED }),
            );
            clientMocks['resolve']!.mockResolvedValue({ id: 'F1', status: FoodResolutionStatus.RESOLVED });
            clientMocks['getStatus']!.mockResolvedValue(
                makeStatusResult({ id: 'F1', status: FoodResolutionStatus.RESOLVED, food: makeFoodView() }),
            );
            const resolved = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            dalMocks['updateResolution']!.mockResolvedValue(resolved);

            const result = await service.resolve('i1', ['cand-1']);

            expect(clientMocks['resolve']).toHaveBeenCalledWith('F1', ['cand-1']);
            expect(result).toBe(resolved);
        });
    });

    describe('createFreeform', () => {
        it('delegates a trimmed name to the DAL freeform creation', async () => {
            const created = makeIngredient({ id: 'f1', isUserEntered: true });
            dalMocks['createFreeform']!.mockResolvedValue(created);

            const result = await service.createFreeform('  Grandma spice  ');

            expect(dalMocks['createFreeform']).toHaveBeenCalledWith('Grandma spice');
            expect(result).toBe(created);
        });
    });
});
