/**
 * Request DTO for `POST /api/v1/ingredients/by-food-variant` (curated U9).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts` (CODING_STANDARDS §15.2).
 * Carries the opaque variant id the details dialog listed; a strict body, so a stray key is a `400`.
 */
import { createZodDto } from 'nestjs-zod';

import { addIngredientByFoodVariantRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/by-food-variant`. */
export class AddIngredientByFoodVariantDto extends createZodDto(addIngredientByFoodVariantRequestSchema) {}
