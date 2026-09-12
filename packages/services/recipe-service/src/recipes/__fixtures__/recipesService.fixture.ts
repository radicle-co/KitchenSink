/**
 * Build a {@link RecipesService} from NAMED collaborators.
 *
 * ## ⛔ Why this exists
 *
 * `RecipesService` takes THIRTEEN constructor parameters, and twenty-seven test sites across seven files
 * passed them positionally. That is Connascence of Position at its worst multiple: adding a collaborator, or
 * reordering two of the same structural type, means editing all twenty-seven — and the compiler catches only
 * the arity change, never a swap of two `Dal`s that happen to satisfy each other's `as never` casts. It is
 * also what makes ANY seam in this service expensive, which is the real reason it comes first: the cost is
 * paid once here instead of once per future extraction.
 *
 * ⚠️ Three of those files had already grown partial local factories (`newService`, `makeService`,
 * `serviceWithPhotos`) *alongside* raw sites — so the pattern was already wanted and inconsistently applied.
 *
 * ## ⛔ Every default is a REAL double, never a no-op
 *
 * `recipes.service.ts` rules this twice, and the rule is load-bearing rather than stylistic: *"a collaborator
 * that defaults to a no-op is how that state comes back — silently, past a green suite"*, and *"A fixture that
 * does not care passes a double; it may not omit it."* U11 shipped the verification gate's consumer with
 * nothing sending it a message, which is the failure those sentences were written about.
 *
 * So the defaults here are the shared `fake*` doubles — each of which records or answers — and NOT `{}`,
 * `undefined`, or a silently-succeeding stub. `verificationQueue` in particular defaults to
 * `fakeVerificationQueue()`, which captures what it was sent so a test can assert the producer ran.
 *
 * ⚠️ `ingredientsDal` and `foodNutrition` get PERMISSIVE generic defaults here because no shared double
 * existed for either; the two test files that care about their data keep their own file-local versions and
 * pass them as overrides. That is DAMP on purpose — the data is the subject of those tests, and unifying it
 * would make each of them assert against a fixture written for the other.
 */
import {
    makeFakeIngredientResolutionsDal,
    makeFakeResolutionBandsDal,
    makeFakeVerificationRedriveDal,
} from '../../ingredients/__fixtures__/resolutionDals.fixture.js';
import type { IngredientsDal } from '../../ingredients/dal/ingredients.dal.js';
import type { IngredientResolutionsDal } from '../../ingredients/resolution/ingredientResolutions.dal.js';
import type { ResolutionBandsDal } from '../../ingredients/resolution/resolutionBands.dal.js';
import type { VerificationRedriveDal } from '../../ingredients/resolution/verificationRedrive.dal.js';
import type { FoodNutritionGateway } from '../../ingredients/foodNutrition.gateway.js';
import type { LineVerificationsDal } from '../dal/lineVerifications.dal.js';
import type { PhotosDal } from '../../photos/dal/photos.dal.js';
import type { RatingsDal } from '../../ratings/dal/ratings.dal.js';
import type { RecipesDal } from '../dal/recipes.dal.js';
import type { VerificationQueuePort } from '../verification.queue.js';
import type { VersionsService } from '../../versions/versions.service.js';
import { RecipesService } from '../recipes.service.js';
import {
    emptyFoodNutrition,
    makeRecipeDetailAssembler,
    permissiveIngredientsDal,
} from './recipeDetailAssembler.fixture.js';
import { fakeLineVerificationsDal } from './lineVerificationsDal.fixture.js';
import { fakePhotosDal, RECIPE_PHOTOS_CDN } from './photosDal.fixture.js';
import { fakeRatingsDal } from './ratingsDal.fixture.js';
import { fakeRecipesDal } from './recipesDal.fixture.js';
import { fakeVerificationQueue } from './verificationQueue.fixture.js';
import { makeFakeVersionsService } from './versions.fixture.js';

/** Every collaborator `RecipesService` takes, by NAME rather than by position. */
export interface RecipesServiceCollaborators {
    readonly dal: RecipesDal;
    readonly ingredientsDal: IngredientsDal;
    readonly versions: Pick<VersionsService, 'createSnapshot'>;
    readonly photosCdnUrl: string;
    readonly ratingsDal: RatingsDal;
    readonly verificationQueue: VerificationQueuePort;
    readonly ingredientResolutions: IngredientResolutionsDal;
    readonly resolutionBands: ResolutionBandsDal;
    readonly verificationRedrive: VerificationRedriveDal;
    /**
     * ⚠️ THE NEXT THREE MOVED TO `RecipeDetailAssembler`, and are still accepted HERE on purpose.
     *
     * They are the assembler's collaborators now, not the service's — but twenty-seven call sites name what
     * they care about, and a test that stubs `photosDal` is saying something about the recipe READ, not about
     * which class happens to own the photo query today. This fixture routes them into the assembler it
     * builds, so the extraction cost those call sites nothing. That is the whole payoff of naming the
     * collaborators before moving any of them.
     *
     * ⚠️ There is deliberately NO `detailAssembler` override. The assembler is always built from these
     * collaborators, so a stubbed `photosDal` can never be silently bypassed by a wholesale assembler — a test
     * that stayed green while its stub went unread is the failure this file's header exists to prevent. A
     * test whose SUBJECT is the assembler builds one with `makeRecipeDetailAssembler`.
     */
    readonly photosDal: PhotosDal;
    readonly foodNutrition: FoodNutritionGateway;
    readonly lineVerificationsDal: LineVerificationsDal;
    readonly rng?: () => number;
}

/**
 * Construct a {@link RecipesService}, naming only the collaborators this test cares about.
 *
 * @param overrides - The collaborators to supply; every other one defaults to its shared double.
 * @returns The service under test.
 */
export function makeRecipesService(overrides: Partial<RecipesServiceCollaborators> = {}): RecipesService {
    const collaborators: RecipesServiceCollaborators = {
        dal: fakeRecipesDal(),
        ingredientsDal: permissiveIngredientsDal(),
        versions: makeFakeVersionsService(),
        photosCdnUrl: RECIPE_PHOTOS_CDN,
        ratingsDal: fakeRatingsDal(),
        verificationQueue: fakeVerificationQueue(),
        ingredientResolutions: makeFakeIngredientResolutionsDal(),
        resolutionBands: makeFakeResolutionBandsDal(),
        verificationRedrive: makeFakeVerificationRedriveDal(),
        photosDal: fakePhotosDal(),
        foodNutrition: emptyFoodNutrition(),
        lineVerificationsDal: fakeLineVerificationsDal(new Map()),
        ...overrides,
    };

    const detailAssembler = makeRecipeDetailAssembler({
        dal: collaborators.dal,
        ingredientsDal: collaborators.ingredientsDal,
        photosDal: collaborators.photosDal,
        photosCdnUrl: collaborators.photosCdnUrl,
        foodNutrition: collaborators.foodNutrition,
        lineVerificationsDal: collaborators.lineVerificationsDal,
        ingredientResolutions: collaborators.ingredientResolutions,
    });

    return new RecipesService(
        collaborators.dal,
        collaborators.ingredientsDal,
        collaborators.versions,
        collaborators.photosCdnUrl,
        collaborators.ratingsDal,
        collaborators.verificationQueue,
        collaborators.ingredientResolutions,
        collaborators.resolutionBands,
        collaborators.verificationRedrive,
        detailAssembler,
        collaborators.rng,
    );
}
