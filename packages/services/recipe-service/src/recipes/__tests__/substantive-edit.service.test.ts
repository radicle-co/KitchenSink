/**
 * T049-test — unit tests for substantive-edit detection on {@link RecipesService.update}.
 *
 * C-004 / FR-005: a change to INGREDIENTS or STEPS is a *substantive* edit and flips
 * `hasSubstantiveEdit` to `true` (and, once true, it stays true). Changes to ONLY metadata
 * (title/description/tags/cuisine/times/servings/dietaryFlags) are NOT substantive and must never flip
 * the flag. Detection compares the incoming patch against the existing aggregate; no database is
 * involved (a fake DAL captures what the service asks the DAL to persist).
 */
import { describe, it, expect, vi } from 'vitest';

import { RecipesService } from '../recipes.service.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photos-dal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratings-dal.fixture.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { makeRecipeRow, makeRecipeStepRow, makeRecipeIngredientRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import type { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import type { Principal } from '../../auth/principal.js';

const OWNER = '01J000000000000000000FREE0';
const OWNER_PRINCIPAL: Principal = { userId: OWNER, sub: 'user_clerk', scopes: [], permissions: [] };
const INGREDIENT_ID = '00000000-0000-4000-8000-0000000000ff';

/** An existing aggregate: one step ("Mix") and one ingredient line (qty 1, unit "unit"). */
function existingAggregate(overrides: Partial<Parameters<typeof makeRecipeRow>[0]> = {}): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, currentVersion: 1, ...overrides });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Mix', timerSeconds: null })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: INGREDIENT_ID,
                quantity: '1',
                unit: 'unit',
                displayText: null,
                sortOrder: 0,
            }),
        ],
    };
}

function fakeDal(
    existing: RecipeAggregate,
    updateResult: RecipeAggregate,
): { dal: RecipesDal; update: ReturnType<typeof vi.fn> } {
    const update = vi.fn().mockResolvedValue(updateResult);
    const dal = {
        create: vi.fn(),
        findById: vi.fn().mockResolvedValue(existing),
        findAll: vi.fn(),
        update,
        softDelete: vi.fn(),
        setVisibility: vi.fn(),
    } as unknown as RecipesDal;

    return { dal, update };
}

function fakeIngredientsDal(): IngredientsDal {
    return {
        findById: vi.fn().mockResolvedValue(makeIngredient({ id: INGREDIENT_ID, name: 'Onion' })),
        findByIds: vi.fn().mockResolvedValue([]),
    } as unknown as IngredientsDal;
}

function service(dal: RecipesDal): RecipesService {
    return new RecipesService(
        dal,
        fakeIngredientsDal(),
        makeFakeVersionsService(),
        fakePhotosDal(),
        RECIPE_PHOTOS_CDN,
        fakeRatingsDal(),
    );
}

describe('RecipesService.update — substantive-edit detection', () => {
    it('does NOT flip hasSubstantiveEdit for a metadata-only patch (title)', async () => {
        const existing = existingAggregate();
        const { dal, update } = fakeDal(existing, existing);
        const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed', cuisine: 'thai', tags: ['x'] };

        await service(dal).update(OWNER_PRINCIPAL, 'r-1', patch);

        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('hasSubstantiveEdit', true);
    });

    it('flips hasSubstantiveEdit to true when STEPS change', async () => {
        const existing = existingAggregate();
        const { dal, update } = fakeDal(existing, existing);
        const patch: UpdateRecipeDto = { expectedVersion: 1, steps: [{ instruction: 'Simmer for a while' }] };

        await service(dal).update(OWNER_PRINCIPAL, 'r-1', patch);

        expect(update.mock.calls[0]?.[1]).toMatchObject({ hasSubstantiveEdit: true });
    });

    it('flips hasSubstantiveEdit to true when INGREDIENTS change (quantity)', async () => {
        const existing = existingAggregate();
        const { dal, update } = fakeDal(existing, existing);
        const patch: UpdateRecipeDto = {
            expectedVersion: 1,
            ingredients: [{ ingredientId: INGREDIENT_ID, name: 'Onion', quantity: 3, unit: 'unit' }],
        };

        await service(dal).update(OWNER_PRINCIPAL, 'r-1', patch);

        expect(update.mock.calls[0]?.[1]).toMatchObject({ hasSubstantiveEdit: true });
    });

    it('does NOT flip when the submitted steps + ingredients are identical to the existing ones', async () => {
        const existing = existingAggregate();
        const { dal, update } = fakeDal(existing, existing);
        const patch: UpdateRecipeDto = {
            expectedVersion: 1,
            steps: [{ instruction: 'Mix' }],
            ingredients: [{ ingredientId: INGREDIENT_ID, name: 'Onion', quantity: 1, unit: 'unit' }],
        };

        await service(dal).update(OWNER_PRINCIPAL, 'r-1', patch);

        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('hasSubstantiveEdit', true);
    });

    it('leaves an already-substantive recipe substantive on a metadata-only patch (never sets false)', async () => {
        const existing = existingAggregate({ hasSubstantiveEdit: true });
        const { dal, update } = fakeDal(existing, existing);
        const patch: UpdateRecipeDto = { expectedVersion: 1, title: 'Renamed again' };

        await service(dal).update(OWNER_PRINCIPAL, 'r-1', patch);

        expect(update.mock.calls[0]?.[1]).not.toHaveProperty('hasSubstantiveEdit', false);
    });
});
