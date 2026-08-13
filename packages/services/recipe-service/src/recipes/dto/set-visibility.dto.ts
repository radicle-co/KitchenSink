/**
 * Request DTO for `PATCH /api/v1/recipes/{id}/visibility` (US2 set-visibility).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS §15.2),
 * which is also the first time this body appears in the published document at all. The schema bounds the
 * literal only; the C-004 policy evaluator in `RecipesService` still
 * decides whether the transition is allowed for the recipe's `(sourceType, isPremium, hasSubstantiveEdit)`, so
 * a refused transition stays a policy answer rather than collapsing into a validation `400`.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `create-recipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { setRecipeVisibilityRequestSchema } from '../recipes.schema.js';

/** Body of `PATCH /api/v1/recipes/{id}/visibility`. */
export class SetVisibilityDto extends createZodDto(setRecipeVisibilityRequestSchema) {}
