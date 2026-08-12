/**
 * Request DTO for `POST /api/v1/recipes`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS §15.2),
 * so the shape the pipe enforces and the shape `@kitchensink/schema-recipe` publishes are ONE object rather
 * than two that happen to agree. `ownerId` is not a field: ownership comes from the verified principal, and
 * zod strips the key if a caller sends one anyway.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata. It is therefore validated ONLY by
 * `nestjs-zod`'s `ZodValidationPipe`, which `RecipesController` binds with `@UsePipes` — under Nest's own
 * `ValidationPipe` this DTO would validate NOTHING while looking correctly wired.
 */
import { createZodDto } from 'nestjs-zod';

import { createRecipeRequestSchema, recipeIngredientInputSchema, recipeStepInputSchema } from '../recipes.schema.js';

/** Body of `POST /api/v1/recipes`. */
export class CreateRecipeDto extends createZodDto(createRecipeRequestSchema) {}

/** One ingredient line on a create/update body. */
export class RecipeIngredientInputDto extends createZodDto(recipeIngredientInputSchema) {}

/** One instruction step on a create/update body; the server assigns `stepNumber` from array order. */
export class CreateRecipeStepInputDto extends createZodDto(recipeStepInputSchema) {}

// NOTE: the bound CONSTANTS are deliberately NOT re-exported from here. They live in
// `@kitchensink/recipe-core` (`recipeRequestBounds.ts`), which is where every consumer — this service, both
// apps, and the published schema package — imports them from. A pass-through export here would give one
// number two import paths, which is how a reader ends up believing there are two numbers.
