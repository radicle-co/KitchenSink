import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoodResolutionStatus, RecipeErrorCode, isRecipeError } from '@kitchensink/recipe-core';
import { NotFoundError } from '@kitchensink/food-service-client';

import type { FoodCatalogGateway } from '../food-catalog.gateway.js';
import type { FoodServiceClients } from '../food-service-clients.factory.js';
import type { IngredientsDal } from '../dal/ingredients.dal.js';
import { IngredientsService, extractNutrition, extractPortions, parsePortion } from '../ingredients.service.js';
import {
    CALLER_TOKEN as CALLER,
    makeAddResult,
    makeCandidateView,
    makeFoodClients,
    makeFoodView,
    makeIngredient,
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

/** A no-op catalog gateway — these suites cover the paths that never blend (see the Stage-2 suite for those). */
function makeCatalogGateway(): FoodCatalogGateway {
    return { search: vi.fn().mockResolvedValue({ hits: [], availability: 'ok' }) } as unknown as FoodCatalogGateway;
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

describe('parsePortion', () => {
    it('parses a label into a normalized grams-per-unit portion', () => {
        expect(parsePortion('1 cup chopped', 125)).toEqual({ unit: 'cup', gramsPerUnit: 125 });
        expect(parsePortion('1 tablespoon', 8)).toEqual({ unit: 'tablespoon', gramsPerUnit: 8 });
    });

    it('divides the gram weight by a multi-unit or fractional amount to get grams-per-unit', () => {
        expect(parsePortion('2 tbsp', 16)).toEqual({ unit: 'tablespoon', gramsPerUnit: 8 });
        expect(parsePortion('1/2 cup', 60)).toEqual({ unit: 'cup', gramsPerUnit: 120 });
    });

    it('returns null for a label with no leading amount, no unit, or a non-positive gram weight', () => {
        expect(parsePortion('cup', 100)).toBeNull(); // no amount
        expect(parsePortion('1', 100)).toBeNull(); // no unit
        expect(parsePortion('1 cup', 0)).toBeNull(); // non-positive weight
    });
});

describe('extractPortions', () => {
    it('normalizes a food record’s portions and de-duplicates by unit (first wins)', () => {
        const portions = extractPortions(
            makeFoodView({
                portions: [
                    { label: '1 cup', gramWeight: 125, source: 'usda' },
                    { label: '2 tbsp', gramWeight: 16, source: 'usda' },
                    { label: '1 cup packed', gramWeight: 200, source: 'usda' }, // dup unit → ignored
                    { label: 'a handful', gramWeight: 30, source: 'usda' }, // unparseable → skipped
                ],
            }),
        );

        expect(portions).toEqual([
            { unit: 'cup', gramsPerUnit: 125 },
            { unit: 'tablespoon', gramsPerUnit: 8 },
        ]);
    });
});

describe('IngredientsService', () => {
    let service: IngredientsService;
    let dal: IngredientsDal;
    let dalMocks: Record<string, ReturnType<typeof vi.fn>>;
    let clients: FoodServiceClients;
    let clientMocks: Record<string, ReturnType<typeof vi.fn>>;
    let standard: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ dal, mocks: dalMocks } = makeDal());
        ({ clients, mocks: clientMocks, standard } = makeFoodClients());
        service = new IngredientsService(dal, clients, makeCatalogGateway());
    });

    describe('caller-credential forwarding (issue #120)', () => {
        it('mints the 8s standard client for THIS caller on every food-touching path', async () => {
            clientMocks['addByName']!.mockResolvedValue(makeAddResult({ id: 'F1' }));
            dalMocks['findByFoodId']!.mockResolvedValue(undefined);
            dalMocks['createFoodBacked']!.mockResolvedValue(makeIngredient({ id: 'i1', foodId: 'F1' }));

            await service.addByName(CALLER, 'Quinoa');

            // The credential the user presented is the one the food call is made under — not a service token,
            // and not an ambient value: the factory is asked for a client for exactly this caller.
            expect(standard).toHaveBeenCalledWith(CALLER);
        });

        it('does NOT reach the food service at all on the local-only paths (no credential use)', async () => {
            dalMocks['search']!.mockResolvedValue([]);
            dalMocks['createFreeform']!.mockResolvedValue(makeIngredient({ id: 'f1' }));

            await service.search('flour');
            await service.createFreeform('Grandma spice');

            expect(standard).not.toHaveBeenCalled();
        });
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

    // Stage 2 replaced the dead `suggestFoods` proxy with `suggest` (the blended typeahead) + `addByFoodId`
    // (the pick). Both are covered in `ingredients-suggest.service.test.ts`.

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

            const result = await service.addByName(CALLER, '  Quinoa  ');

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

            const result = await service.addByName(CALLER, 'Quinoa');

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

            const result = await service.addByName(CALLER, 'Ambiguous thing');

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

            const result = await service.refreshStatus(CALLER, 'i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
                nutrition: { caloriesPer100g: 364, proteinGPer100g: 10.3, carbsGPer100g: 76.3, fatGPer100g: 0.98 },
                portions: [], // makeFoodView supplies no portions → empty (extractPortions still runs)
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

            await service.refreshStatus(CALLER, 'i1');

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

            const result = await service.refreshStatus(CALLER, 'i1');

            expect(dalMocks['updateResolution']).toHaveBeenCalledWith('i1', {
                foodResolutionStatus: FoodResolutionStatus.NOT_FOUND,
            });
            expect(result.foodResolutionStatus).toBe(FoodResolutionStatus.NOT_FOUND);
        });

        it('is a no-op for a freeform ingredient (no food reference)', async () => {
            const freeform = makeIngredient({ id: 'f1', isUserEntered: true });
            dalMocks['findById']!.mockResolvedValue(freeform);

            const result = await service.refreshStatus(CALLER, 'f1');

            expect(result).toBe(freeform);
            expect(clientMocks['getStatus']).not.toHaveBeenCalled();
        });

        it('throws RECIPE_NOT_FOUND (as a real Error) for an unknown ingredient id', async () => {
            dalMocks['findById']!.mockResolvedValue(undefined);

            // Must be a real stack-bearing Error carrying the domain code (not a bare object literal),
            // so it egresses the shared `{ code, message, details }` envelope with a usable stack.
            await expect(service.refreshStatus(CALLER, 'missing')).rejects.toSatisfy(
                (e: unknown) => e instanceof Error && isRecipeError(e) && e.code === RecipeErrorCode.RECIPE_NOT_FOUND,
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

            const result = await service.getCandidates(CALLER, 'i1');

            expect(clientMocks['getCandidates']).toHaveBeenCalledWith('F1');
            expect(result).toEqual([candidate]);
        });

        it('getCandidates returns empty for a freeform ingredient', async () => {
            dalMocks['findById']!.mockResolvedValue(makeIngredient({ id: 'f1', isUserEntered: true }));

            expect(await service.getCandidates(CALLER, 'f1')).toEqual([]);
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

            const result = await service.resolve(CALLER, 'i1', ['cand-1']);

            expect(clientMocks['resolve']).toHaveBeenCalledWith('F1', ['cand-1']);
            expect(result).toBe(resolved);
        });

        it('resolve is a converge-only NO-OP on an already-RESOLVED ingredient (never re-points it)', async () => {
            // The catalog is ownerless + shared (R5): re-resolving a settled row would let one caller
            // overwrite the food link/nutrition another caller's resolution produced. An already-RESOLVED
            // ingredient must be returned unchanged WITHOUT any food-service call or DB write. Removing the
            // converge-only guard makes the food client + updateResolution fire again → this test fails.
            const alreadyResolved = makeIngredient({
                id: 'i1',
                foodId: 'F1',
                foodResolutionStatus: FoodResolutionStatus.RESOLVED,
            });
            dalMocks['findById']!.mockResolvedValue(alreadyResolved);

            const result = await service.resolve(CALLER, 'i1', ['a-different-candidate']);

            expect(result).toBe(alreadyResolved);
            expect(clientMocks['resolve']).not.toHaveBeenCalled();
            expect(clientMocks['getStatus']).not.toHaveBeenCalled();
            expect(dalMocks['updateResolution']).not.toHaveBeenCalled();
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
