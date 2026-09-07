/**
 * T139-test — substantive edits on an IMPORTED recipe preserve its import lineage.
 *
 * When a premium user substantively edits an `imported_public` recipe, `hasSubstantiveEdit` flips to
 * true (unlocking the imported_public→private transition), but the import provenance
 * (`sourceType`/`sourceUrl`/`sourceAttribution`/`clonedFromId`) is NEVER rewritten by the update — the
 * service must not touch those columns. No database is involved.
 */
import { describe, it, expect, vi } from 'vitest';

import { RecipesService } from '../recipes.service.js';
import { makeFakeVersionsService } from '../__fixtures__/versions.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from '../__fixtures__/photosDal.fixture.js';
import { fakeRatingsDal } from '../__fixtures__/ratingsDal.fixture.js';
import type { RecipesDal, RecipeAggregate } from '../dal/recipes.dal.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import { makeRecipeRow, makeRecipeStepRow, makeRecipeIngredientRow } from '../../__fixtures__/index.js';
import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import type { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import type { Principal } from '../../auth/principal.js';
import { fakeVerificationQueue } from '../__fixtures__/verificationQueue.fixture.js';
import { fakeLineVerificationsDal } from '../__fixtures__/lineVerificationsDal.fixture.js';
import { FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import type { RecipeTx } from '../../database/unitOfWork.js';

/**
 * A `FoodNutritionGateway` double for suites that are NOT about nutrition (U10).
 *
 * It answers `absent` — the honest degrade shape — rather than fabricating numbers, so a suite that starts
 * depending on nutrition fails loudly here instead of quietly asserting invented values.
 */
const nutritionGatewayDouble = {
    lookup: async () => ({ byFoodId: new Map(), degraded: true }),
} as never;

const OWNER = '01J0000000000000000000PRO0';
const OWNER_PRINCIPAL: Principal = { userId: OWNER, sub: 'user_clerk', scopes: [], permissions: [] };
const INGREDIENT_ID = '00000000-0000-4000-8000-0000000000ff';

function importedAggregate(): RecipeAggregate {
    const recipe = makeRecipeRow({
        id: 'r-imp',
        ownerId: OWNER,
        currentVersion: 1,
        sourceType: 'imported_public',
        sourceUrl: 'https://example.com/original',
        sourceAttribution: 'Original Author',
        hasSubstantiveEdit: false,
    });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id, stepNumber: 1, instruction: 'Boil', timerSeconds: null })],
        ingredients: [
            makeRecipeIngredientRow({
                recipeId: recipe.id,
                ingredientId: INGREDIENT_ID,
                quantity: '2',
                unit: 'cup',
                displayText: null,
                sortOrder: 0,
            }),
        ],
    };
}

function service(existing: RecipeAggregate): { svc: RecipesService; update: ReturnType<typeof vi.fn> } {
    const update = vi.fn().mockResolvedValue(existing);
    const dal = {
        create: vi.fn(),
        findById: vi.fn().mockResolvedValue(existing),
        findAll: vi.fn(),
        update,
        softDelete: vi.fn(),
        setVisibility: vi.fn(),
        transaction: vi.fn(async (fn: (tx: RecipeTx) => Promise<unknown>) => fn(FAKE_TX)),
    } as unknown as RecipesDal;
    const ingredientsDal = {
        findById: vi.fn(),
        findByIds: vi.fn().mockResolvedValue([makeIngredient({ id: INGREDIENT_ID, name: 'Rice' })]),
    } as unknown as IngredientsDal;

    return {
        svc: new RecipesService(
            dal,
            ingredientsDal,
            makeFakeVersionsService(),
            fakePhotosDal(),
            RECIPE_PHOTOS_CDN,
            fakeRatingsDal(),
            nutritionGatewayDouble,
            fakeVerificationQueue(),
            fakeLineVerificationsDal(),
        ),
        update,
    };
}

describe('RecipesService.update — imported lineage preserved through a substantive edit', () => {
    it('flips hasSubstantiveEdit but never rewrites the source provenance columns', async () => {
        const existing = importedAggregate();
        const { svc, update } = service(existing);
        const patch: UpdateRecipeDto = {
            expectedVersion: 1,
            steps: [{ instruction: 'Steam instead of boiling' }],
        };

        await svc.update(OWNER_PRINCIPAL, 'r-imp', patch);

        const persisted = update.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(persisted).toMatchObject({ hasSubstantiveEdit: true });
        expect(persisted).not.toHaveProperty('sourceType');
        expect(persisted).not.toHaveProperty('sourceUrl');
        expect(persisted).not.toHaveProperty('sourceAttribution');
        expect(persisted).not.toHaveProperty('clonedFromId');
    });
});
