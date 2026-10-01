/**
 * T043b-test (unit) — the recipe ↔ binding composition seam, over the binding grain (plan 002 U4, R9).
 *
 * These tests pin the behavior of `RecipesService` over a fake `RecipesDal`, a fake bindings repository and a
 * fake food answer:
 *
 *  - **create** reads each line's binding in one batch, persists lines that name their binding and carry NO
 *    name, and composes the response lines with the name food gives the bound food.
 *  - a line naming a binding that does not exist fails fast with `UNKNOWN_INGREDIENT` (400), before any write.
 *  - **getById** composes the lines from the aggregate's rows and their bindings.
 *  - **update** plans and forwards lines only when the patch carries `ingredients`; an omitted `ingredients`
 *    patch leaves the lines alone.
 *
 * No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';

import { FoodResolutionStatus, RecipeErrorCode } from '@kitchensink/recipe-core';

import type { RecipeAggregate } from '../dal/recipes.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import { fakeFoodLookupsDal, makeRootArm } from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { Principal } from '../../auth/principal.js';
import { fakeRecipesDal, FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';

/**
 * A `FoodNutritionGateway` double for suites that are NOT about nutrition (U10).
 *
 * It answers `absent` — the honest degrade shape — rather than fabricating numbers, so a suite that starts
 * depending on nutrition fails loudly here instead of quietly asserting invented values.
 */
const nutritionGatewayDouble = {
    lookup: async (_caller: unknown, ids: readonly string[]) => ({ byFoodId: new Map(), unansweredIds: new Set(ids) }),
} as never;

const OWNER = '01J000000000000000000FREE0';
const ONION_ID = '00000000-0000-4000-8000-0000000000ff';
const ONION_FOOD_ID = '01JONIONFOOD00000000000001';
const ONION = makeRootArm({ lookupId: ONION_ID, foodId: ONION_FOOD_ID });

/** The verified owner principal for these composition tests (free-tier — visibility defaults to public). */
const OWNER_PRINCIPAL: Principal = {
    userId: OWNER,
    sub: 'user_clerk',
    scopes: [],
    permissions: [],
    principalKind: 'real',
    containment: 'enforce',
};

/** A recipe aggregate with a single onion line. */
function aggregateWithOnion(): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeIngredientLineRow({
                recipeId: recipe.id,
                foodLookupId: ONION_ID,
                quantity: '2',
                unit: 'cup',
                displayText: 'diced',
                sortOrder: 0,
            }),
        ],
    };
}

/** Food's answer: the onion's root food is live, under `name`. */
function foodNaming(name: string): FoodRefsGateway {
    const answer: FoodRefAnswer = {
        outcome: 'found',
        name: canonicalIngredientName(name),
        status: 'RESOLVED',
        isPrivate: false,
    };

    return {
        resolve: vi.fn((_caller: unknown, refs: readonly FoodRef[]) =>
            Promise.resolve({
                answers: new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, answer])),
                degraded: false,
            }),
        ),
    } as unknown as FoodRefsGateway;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error('Expected the promise to reject, but it resolved.');
}

const CREATE_DTO: CreateRecipeDto = {
    title: 'Soup',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    ingredients: [{ ingredientId: ONION_ID, quantity: { kind: 'exact', value: 2 }, unit: 'cup', notes: 'diced' }],
    steps: [{ instruction: 'Mix' }],
};

/** The line the detail read composes for the onion: food's name, the root food id, and the bound status. */
const ONION_LINE = {
    ingredientId: ONION_ID,
    name: 'Onion',
    foodId: ONION_FOOD_ID,
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    notes: 'diced',
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
};

describe('RecipesService.create — line composition (T043b)', () => {
    it('reads the bindings in one batch, persists lines with NO name, and composes the response lines', async () => {
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const lookups = fakeFoodLookupsDal(ONION);
        const service = makeRecipesService({
            dal,
            lookups,
            refs: foodNaming('Onion'),
            foodNutrition: nutritionGatewayDouble,
        });

        const response = await service.create(OWNER_PRINCIPAL, CREATE_DTO, undefined);

        expect(vi.mocked(lookups.findByIds).mock.calls[0]?.[0]).toStrictEqual([ONION_ID]);
        expect(vi.mocked(dal.create).mock.calls[0]?.[0].ingredients).toStrictEqual([
            {
                foodLookupId: ONION_ID,
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                displayText: 'diced',
                sortOrder: 0,
            },
        ]);
        expect(response.ingredients).toEqual([ONION_LINE]);
    });

    it('⛔ indexes the name FOOD gives the binding — a request has no name to poison the search text with', async () => {
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const service = makeRecipesService({
            dal,
            lookups: fakeFoodLookupsDal(ONION),
            refs: foodNaming('Red onion'),
            foodNutrition: nutritionGatewayDouble,
        });

        await service.create(OWNER_PRINCIPAL, CREATE_DTO, undefined);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ ingredientNamesText: 'Red onion' }), FAKE_TX);
    });

    it('rejects a line naming a binding that does not exist with UNKNOWN_INGREDIENT (not a raw FK error)', async () => {
        const dal = fakeRecipesDal();
        const service = makeRecipesService({
            dal,
            lookups: fakeFoodLookupsDal(),
            foodNutrition: nutritionGatewayDouble,
        });

        const error = await catchError(service.create(OWNER_PRINCIPAL, CREATE_DTO, undefined));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.UNKNOWN_INGREDIENT);
        expect(dal.create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.getById — line composition (T043b)', () => {
    it('composes the lines from the aggregate rows and their bindings', async () => {
        const dal = fakeRecipesDal({ findById: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const service = makeRecipesService({
            dal,
            lookups: fakeFoodLookupsDal(ONION),
            refs: foodNaming('Onion'),
            foodNutrition: nutritionGatewayDouble,
        });

        const response = await service.getById({ viewerId: OWNER, id: 'r-1', caller: undefined, budget: 'read' });

        expect(response.ingredients).toEqual([ONION_LINE]);
    });
});

describe('RecipesService.update — line composition (T043b)', () => {
    it('plans and forwards the lines when the patch carries ingredients', async () => {
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(aggregateWithOnion()),
            update: vi.fn().mockResolvedValue(aggregateWithOnion()),
        });
        const lookups = fakeFoodLookupsDal(ONION);
        const service = makeRecipesService({
            dal,
            lookups,
            refs: foodNaming('Onion'),
            foodNutrition: nutritionGatewayDouble,
        });

        const patch: UpdateRecipeDto = {
            expectedVersion: 1,
            ingredients: [
                { ingredientId: ONION_ID, quantity: { kind: 'exact', value: 2 }, unit: 'cup', notes: 'diced' },
            ],
        };
        await service.update(OWNER_PRINCIPAL, 'r-1', patch, undefined);

        expect(vi.mocked(lookups.findByIds).mock.calls[0]?.[0]).toStrictEqual([ONION_ID]);
        expect(dal.update).toHaveBeenCalledWith(
            'r-1',
            expect.objectContaining({
                ingredientNamesText: 'Onion',
                ingredients: [expect.objectContaining({ foodLookupId: ONION_ID })],
            }),
            FAKE_TX,
        );
    });

    it('leaves the lines and the search text alone when the patch omits ingredients', async () => {
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(aggregateWithOnion()),
            update: vi.fn().mockResolvedValue(aggregateWithOnion()),
        });
        const service = makeRecipesService({
            dal,
            lookups: fakeFoodLookupsDal(ONION),
            refs: foodNaming('Onion'),
            foodNutrition: nutritionGatewayDouble,
        });

        await service.update(OWNER_PRINCIPAL, 'r-1', { expectedVersion: 1, title: 'Renamed' }, undefined);

        const updateArg = vi.mocked(dal.update).mock.calls[0]?.[1];
        expect(updateArg).not.toHaveProperty('ingredients');
        expect(updateArg).not.toHaveProperty('ingredientNamesText');
    });
});
