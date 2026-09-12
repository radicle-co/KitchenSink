/**
 * Build a {@link RecipeDetailAssembler} from NAMED collaborators.
 *
 * Same discipline as `recipesService.fixture.ts`, for the same reason: seven positional parameters is the
 * shape that made every seam in this vertical expensive, and it is not worth reintroducing in the class that
 * was extracted to relieve it.
 *
 * ⛔ Every default is a REAL double, never a no-op — the rule `recipes.service.ts` states twice and the one
 * `recipesService.fixture.ts`'s header argues at length. `foodNutrition` defaults to a gateway that REACHES
 * the service and finds nothing, which is a genuine, reachable answer (the food service knows none of these
 * ids) and leaves every line's nutrition absent; a test that asserts nutrition passes its own.
 */
import { vi } from 'vitest';

import { makeIngredient } from '../../ingredients/__fixtures__/ingredients.fixtures.js';
import { makeFakeIngredientResolutionsDal } from '../../ingredients/__fixtures__/resolutionDals.fixture.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import type { FoodNutritionGateway, FoodNutritionLookup } from '../../ingredients/foodNutrition.gateway.js';
import type { IngredientResolutionsDal } from '../../ingredients/resolution/ingredientResolutions.dal.js';
import type { PhotosDal } from '../../photos/dal/photos.dal.js';
import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import type { RecipesDal } from '../dal/recipes.dal.js';
import { RecipeDetailAssembler } from '../recipeDetail.assembler.js';
import { fakeLineVerificationsDal } from './lineVerificationsDal.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from './photosDal.fixture.js';
import { fakeRecipesDal } from './recipesDal.fixture.js';

/** Every collaborator {@link RecipeDetailAssembler} takes, by NAME rather than by position. */
export interface RecipeDetailAssemblerCollaborators {
    readonly dal: Pick<RecipesDal, 'findNutritionInputs'>;
    readonly ingredientsDal: IngredientsDal;
    readonly photosDal: PhotosDal;
    readonly photosCdnUrl: string;
    readonly foodNutrition: FoodNutritionGateway;
    readonly lineVerificationsDal: LineVerificationsDal;
    readonly ingredientResolutions: IngredientResolutionsDal;
}

/**
 * A permissive catalog DAL — every requested id resolves to a named ingredient.
 *
 * ⚠️ Deliberately generic. A test whose SUBJECT is the catalog's content passes its own.
 */
export function permissiveIngredientsDal(): IngredientsDal {
    return {
        findById: vi.fn().mockImplementation((id: string) => Promise.resolve(makeIngredient({ id, name: 'Onion' }))),
        findByIds: vi
            .fn()
            .mockImplementation((ids: readonly string[]) =>
                Promise.resolve(ids.map((id) => makeIngredient({ id, name: 'Onion' }))),
            ),
        // No catalog food here is PRIVATE. Both privacy reads must ANSWER: the producer fails closed and the
        // detail read fails open on a throw, so a missing method would exercise their failure paths instead.
        privateFoodIngredientIds: vi.fn().mockResolvedValue(new Set<string>()),
        privateFoodOwnersByIngredientIds: vi.fn().mockResolvedValue(new Map<string, string>()),
    } as unknown as IngredientsDal;
}

/**
 * A food gateway that reaches the service and finds nothing — a real answer, not a stub that does nothing.
 *
 * ⚠️ The answer is TYPED as {@link FoodNutritionLookup} on purpose. It was once `{ byId, unknownIds }` behind an
 * `as unknown as` cast, and every detail read over this default threw — `recipeDetailAssembler.fixture.test.ts`
 * is what caught it.
 */
export function emptyFoodNutrition(): FoodNutritionGateway {
    const nothingFound: FoodNutritionLookup = { byFoodId: new Map(), degraded: false };

    return { lookup: vi.fn().mockResolvedValue(nothingFound) } as unknown as FoodNutritionGateway;
}

/**
 * Construct a {@link RecipeDetailAssembler}, naming only the collaborators this test cares about.
 *
 * @param overrides - The collaborators to supply; every other one defaults to its shared double.
 * @returns The assembler.
 */
export function makeRecipeDetailAssembler(
    overrides: Partial<RecipeDetailAssemblerCollaborators> = {},
): RecipeDetailAssembler {
    const collaborators: RecipeDetailAssemblerCollaborators = {
        dal: fakeRecipesDal(),
        ingredientsDal: permissiveIngredientsDal(),
        photosDal: fakePhotosDal(),
        photosCdnUrl: RECIPE_PHOTOS_CDN,
        foodNutrition: emptyFoodNutrition(),
        lineVerificationsDal: fakeLineVerificationsDal(new Map()),
        ingredientResolutions: makeFakeIngredientResolutionsDal(),
        ...overrides,
    };

    return new RecipeDetailAssembler(
        collaborators.dal,
        collaborators.ingredientsDal,
        collaborators.photosDal,
        collaborators.photosCdnUrl,
        collaborators.foodNutrition,
        collaborators.lineVerificationsDal,
        collaborators.ingredientResolutions,
    );
}
