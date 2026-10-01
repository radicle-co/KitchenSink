/**
 * Build a {@link RecipeDetailAssembler} from NAMED collaborators.
 *
 * Same discipline as `recipesService.fixture.ts`, for the same reason: eight positional parameters is the
 * shape that made every seam in this vertical expensive, and it is not worth reintroducing in the class that
 * was extracted to relieve it.
 *
 * ⛔ Every default is a REAL double, never a no-op — the rule `recipes.service.ts` states twice and the one
 * `recipesService.fixture.ts`'s header argues at length. `foodNutrition` defaults to a gateway that REACHES
 * the service and finds nothing, which is a genuine, reachable answer (the food service knows none of these
 * ids) and leaves every line's nutrition absent; a test that asserts nutrition passes its own. The bindings and
 * food's name answers default to a shared root food food shows by name, for the same reason.
 */
import { vi } from 'vitest';

import type { FoodLookupArm, FoodRef } from '../../database/schema/foodLookupArm.js';
import { makeFakeIngredientResolutionsDal } from '../../ingredients/__fixtures__/resolutionDals.fixture.js';
import type { FoodLookupsDal } from '../../ingredients/dal/foodLookups.dal.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodNutritionGateway, FoodNutritionLookup } from '../../ingredients/foodNutrition.gateway.js';
import type { FoodRefLookup, FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import { LineIdentityReader } from '../../ingredients/lineIdentity.reader.js';
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
    readonly lookups: FoodLookupsDal;
    readonly refs: FoodRefsGateway;
    readonly photosDal: PhotosDal;
    readonly photosCdnUrl: string;
    readonly foodNutrition: FoodNutritionGateway;
    readonly lineVerificationsDal: LineVerificationsDal;
    readonly ingredientResolutions: IngredientResolutionsDal;
}

/**
 * The shared root food every lookup id binds to under {@link permissiveFoodLookupsDal}.
 *
 * @param lookupId - The binding's id.
 * @returns The food id it binds. Pure.
 */
export function permissiveFoodIdOf(lookupId: string): string {
    return `food-of-${lookupId}`;
}

/**
 * A bindings DAL in which every requested id is a binding to a SHARED root food.
 *
 * ⚠️ Deliberately generic. A test whose SUBJECT is the binding passes its own arms.
 */
export function permissiveFoodLookupsDal(): FoodLookupsDal {
    return {
        findByIds: vi.fn().mockImplementation((ids: readonly string[]) =>
            Promise.resolve(
                new Map(
                    ids.map((id): [string, FoodLookupArm] => [
                        id,
                        {
                            kind: 'root',
                            lookupId: id,
                            foodId: permissiveFoodIdOf(id),
                            foodOwnerId: null,
                            createdAt: new Date('2026-01-01T00:00:00.000Z'),
                        },
                    ]),
                ),
            ),
        ),
    } as unknown as FoodLookupsDal;
}

/**
 * A refs gateway that reaches food, which shows every food as a live, shared food named "Onion".
 *
 * ⚠️ The answer is TYPED as {@link FoodRefLookup} so a wrong shape cannot hide behind the cast.
 */
export function permissiveFoodRefs(): FoodRefsGateway {
    return {
        resolve: vi.fn().mockImplementation((_caller: unknown, refs: readonly FoodRef[]) => {
            const answer: FoodRefAnswer = {
                outcome: 'found',
                name: canonicalIngredientName('Onion'),
                status: 'RESOLVED',
                isPrivate: false,
            };
            const lookup: FoodRefLookup = {
                answers: new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, answer])),
                degraded: false,
            };

            return Promise.resolve(lookup);
        }),
    } as unknown as FoodRefsGateway;
}

/**
 * A food gateway that reaches the service and finds nothing — a real answer, not a stub that does nothing.
 *
 * ⚠️ The answer is TYPED as {@link FoodNutritionLookup} on purpose: a wrong shape behind an `as unknown as` cast
 * makes every detail read over this default throw. `recipeDetailAssembler.fixture.test.ts` guards it.
 */
export function emptyFoodNutrition(): FoodNutritionGateway {
    const nothingFound: FoodNutritionLookup = { byFoodId: new Map(), unansweredIds: new Set() };

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
        lookups: permissiveFoodLookupsDal(),
        refs: permissiveFoodRefs(),
        photosDal: fakePhotosDal(),
        photosCdnUrl: RECIPE_PHOTOS_CDN,
        foodNutrition: emptyFoodNutrition(),
        lineVerificationsDal: fakeLineVerificationsDal(new Map()),
        ingredientResolutions: makeFakeIngredientResolutionsDal(),
        ...overrides,
    };

    return new RecipeDetailAssembler(
        collaborators.dal,
        collaborators.lookups,
        new LineIdentityReader(collaborators.lookups, collaborators.refs),
        collaborators.photosDal,
        collaborators.photosCdnUrl,
        collaborators.foodNutrition,
        collaborators.lineVerificationsDal,
        collaborators.ingredientResolutions,
    );
}
