/**
 * T043b-test (unit) — recipe↔ingredient composition seam.
 *
 * Closes the parallel-agent seam where the recipes vertical persisted only `recipes` + `recipe_steps` +
 * the denormalized `ingredient_names_text` and emitted an EMPTY `ingredients` array. These tests pin the
 * reconciled behavior of {@link RecipesService} over a fake {@link RecipesDal} and a fake
 * {@link IngredientsDal}:
 *
 *  - **create** resolves each DTO line against the ingredients catalog (`IngredientsDal.findById`),
 *    passes the resolved link rows to `RecipesDal.create`, and composes the persisted junction into the
 *    response `ingredients` array (canonical name from the catalog, quantity coerced to a number).
 *  - an unresolved `ingredientId` fails fast with `UNKNOWN_INGREDIENT` (400) rather than a raw FK 500.
 *  - **getById** composes `ingredients` from the aggregate's junction rows.
 *  - **update** resolves + forwards lines only when the patch carries `ingredients`; an omitted
 *    `ingredients` patch never touches the catalog and leaves the link set alone.
 *
 * No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipesService } from '../recipes.service.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import type { RecipeAggregate, RecipesDal } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { isRecipeDomainError } from '../recipe.error.js';
import { makeRecipeIngredientRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import type { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import type { Principal } from '../../auth/principal.js';

const OWNER = '01J000000000000000000FREE0';
const ONION_ID = '00000000-0000-4000-8000-0000000000ff';

/** The verified owner principal for these composition tests (free-tier — visibility defaults to public). */
const OWNER_PRINCIPAL: Principal = { userId: OWNER, sub: 'user_clerk', scopes: [], permissions: [] };

/** A recipe aggregate whose junction carries a single composed onion line. */
function aggregateWithOnion(): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix' })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: ONION_ID,
                ingredientName: 'Onion',
                quantity: '2',
                unit: 'cup',
                displayText: 'diced',
                sortOrder: 0,
            }),
        ],
    };
}

function fakeRecipesDal(overrides: Partial<RecipesDal> = {}): RecipesDal {
    return {
        create: vi.fn(),
        findById: vi.fn(),
        findAll: vi.fn(),
        update: vi.fn(),
        softDelete: vi.fn(),
        ...overrides,
    } as unknown as RecipesDal;
}

function fakeIngredientsDal(overrides: Partial<IngredientsDal> = {}): IngredientsDal {
    return {
        findById: vi.fn().mockResolvedValue(makeIngredient({ id: ONION_ID, name: 'Onion', isUserEntered: false })),
        ...overrides,
    } as unknown as IngredientsDal;
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
    ingredients: [{ ingredientId: ONION_ID, name: 'Onion', quantity: 2, unit: 'cup', notes: 'diced' }],
    steps: [{ instruction: 'Mix' }],
};

describe('RecipesService.create — ingredient composition (T043b)', () => {
    it('resolves each line, persists the junction, and composes the response ingredients', async () => {
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const ingredientsDal = fakeIngredientsDal();
        const service = new RecipesService(dal, ingredientsDal, makeFakeVersionsService());

        const response = await service.create(OWNER_PRINCIPAL, CREATE_DTO);

        // The catalog was consulted for the line's canonical identity.
        expect(ingredientsDal.findById).toHaveBeenCalledWith(ONION_ID);
        // Resolved link rows are handed to the DAL (persisted atomically with the recipe).
        expect(dal.create).toHaveBeenCalledWith(
            expect.objectContaining({
                ingredientNamesText: 'Onion',
                ingredients: [
                    expect.objectContaining({
                        ingredientId: ONION_ID,
                        ingredientName: 'Onion',
                        quantity: 2,
                        unit: 'cup',
                        displayText: 'diced',
                        sortOrder: 0,
                        isUserEntered: false,
                    }),
                ],
            }),
        );
        // The response is composed from the persisted junction (no longer an empty array).
        expect(response.ingredients).toEqual([
            { ingredientId: ONION_ID, name: 'Onion', quantity: 2, unit: 'cup', notes: 'diced', isUserEntered: false },
        ]);
    });

    // ADV-2 search-text poisoning: the search-feeding `ingredient_names_text` MUST be built from the
    // resolved CATALOG name, never the client DTO `name`. Here the client sends a poison string for the
    // onion id; the persisted search text must still be the catalog 'Onion'. Building it from dto.name
    // (the mutation) would index the recipe under 'zzz-not-a-real-name' and fails this test.
    it('builds ingredient_names_text from the catalog name, ignoring a poisoned client name', async () => {
        const dal = fakeRecipesDal({ create: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const service = new RecipesService(dal, fakeIngredientsDal(), makeFakeVersionsService());

        const poisoned: CreateRecipeDto = {
            ...CREATE_DTO,
            ingredients: [{ ingredientId: ONION_ID, name: 'zzz-not-a-real-name', quantity: 2, unit: 'cup' }],
        };
        await service.create(OWNER_PRINCIPAL, poisoned);

        expect(dal.create).toHaveBeenCalledWith(expect.objectContaining({ ingredientNamesText: 'Onion' }));
    });

    it('rejects an unresolved ingredientId with UNKNOWN_INGREDIENT (not a raw FK error)', async () => {
        const dal = fakeRecipesDal();
        const ingredientsDal = fakeIngredientsDal({ findById: vi.fn().mockResolvedValue(undefined) });
        const service = new RecipesService(dal, ingredientsDal, makeFakeVersionsService());

        const error = await catchError(service.create(OWNER_PRINCIPAL, CREATE_DTO));

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.UNKNOWN_INGREDIENT);
        expect(dal.create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.getById — ingredient composition (T043b)', () => {
    it('composes ingredients from the aggregate junction rows', async () => {
        const dal = fakeRecipesDal({ findById: vi.fn().mockResolvedValue(aggregateWithOnion()) });
        const service = new RecipesService(dal, fakeIngredientsDal(), makeFakeVersionsService());

        const response = await service.getById(OWNER, 'r-1');

        expect(response.ingredients).toEqual([
            { ingredientId: ONION_ID, name: 'Onion', quantity: 2, unit: 'cup', notes: 'diced', isUserEntered: false },
        ]);
    });
});

describe('RecipesService.update — ingredient composition (T043b)', () => {
    it('resolves + forwards link rows when the patch carries ingredients', async () => {
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(aggregateWithOnion()),
            update: vi.fn().mockResolvedValue(aggregateWithOnion()),
        });
        const ingredientsDal = fakeIngredientsDal();
        const service = new RecipesService(dal, ingredientsDal, makeFakeVersionsService());

        const patch: UpdateRecipeDto = {
            expectedVersion: 1,
            ingredients: [{ ingredientId: ONION_ID, name: 'Onion', quantity: 2, unit: 'cup', notes: 'diced' }],
        };
        await service.update(OWNER, 'r-1', patch);

        expect(ingredientsDal.findById).toHaveBeenCalledWith(ONION_ID);
        expect(dal.update).toHaveBeenCalledWith(
            'r-1',
            expect.objectContaining({ ingredients: [expect.objectContaining({ ingredientId: ONION_ID })] }),
        );
    });

    it('never touches the catalog or link set when the patch omits ingredients', async () => {
        const dal = fakeRecipesDal({
            findById: vi.fn().mockResolvedValue(aggregateWithOnion()),
            update: vi.fn().mockResolvedValue(aggregateWithOnion()),
        });
        const ingredientsDal = fakeIngredientsDal();
        const service = new RecipesService(dal, ingredientsDal, makeFakeVersionsService());

        await service.update(OWNER, 'r-1', { expectedVersion: 1, title: 'Renamed' });

        expect(ingredientsDal.findById).not.toHaveBeenCalled();
        const updateArg = (dal.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
            string,
            unknown
        >;
        expect(updateArg.ingredients).toBeUndefined();
    });
});
