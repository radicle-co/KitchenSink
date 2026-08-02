/**
 * T046 — request DTO for `PATCH /api/v1/recipes/{id}/visibility` (US2 set-visibility).
 *
 * Carries the single requested visibility literal (`public` | `private`); the C-004 policy evaluator in
 * {@link import('../recipes.service.js').RecipesService} decides whether the transition is allowed for
 * the recipe's `(sourceType, isPremium, hasSubstantiveEdit)`. Validation runs via the controller-scoped
 * `ValidationPipe`.
 */
import { IsIn } from 'class-validator';
import { RecipeVisibility } from '@kitchensink/recipe-core';

/** The allowed visibility literals, derived from the shared `RecipeVisibility` value object. */
const RECIPE_VISIBILITIES = Object.values(RecipeVisibility);

/** Body of `PATCH /api/v1/recipes/{id}/visibility`. */
export class SetVisibilityDto {
    @IsIn(RECIPE_VISIBILITIES)
    visibility!: RecipeVisibility;
}
