/**
 * Request DTO for `POST /api/v1/ingredients/food-nutrition` (plan 002 U9).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts` (CODING_STANDARDS §15.2).
 */
import { createZodDto } from 'nestjs-zod';

import { ingredientFoodNutritionRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/food-nutrition`. */
export class IngredientFoodNutritionDto extends createZodDto(ingredientFoodNutritionRequestSchema) {}
