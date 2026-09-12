/**
 * Request DTO for `POST /api/v1/recipes/{id}/ingredients/{position}/rebind` (plan 002 U5).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../../ingredients/ingredients.schema.ts`, where the
 * schema lives beside the food-id and name shapes it composes (CODING_STANDARDS §15.2).
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { rebindIngredientLineRequestSchema } from '../../ingredients/ingredients.schema.js';

/** Body of `POST /api/v1/recipes/{id}/ingredients/{position}/rebind`. */
export class RebindIngredientLineDto extends createZodDto(rebindIngredientLineRequestSchema) {}
