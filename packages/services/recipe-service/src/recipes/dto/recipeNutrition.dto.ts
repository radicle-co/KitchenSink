/**
 * Request DTO for `POST /api/v1/recipes/nutrition-batch` (the deferred calorie lookup).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS
 * §15.2), so the shape the pipe enforces and the shape `@kitchensink/schema-recipe` publishes are ONE
 * object. The `MAX_NUTRITION_RECIPE_IDS` cap therefore rejects through the boundary parser, which is what
 * makes the over-cap `400` the published `VALIDATION_FAILED` envelope carrying `details.fields` rather
 * than a hand-written message no client can parse.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { recipeNutritionRequestSchema } from '../recipes.schema.js';

/** Body of `POST /api/v1/recipes/nutrition-batch`. */
export class RecipeNutritionRequestDto extends createZodDto(recipeNutritionRequestSchema) {}
