/**
 * Request DTO for `POST /api/v1/ingredients/by-food`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts`
 * (CODING_STANDARDS §15.2). Carries the opaque food id taken from a `catalog` typeahead suggestion; the
 * server never accepts a source-native key (a USDA `fdcId`) here.
 */
import { createZodDto } from 'nestjs-zod';

import { addIngredientByFoodRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/by-food`. */
export class AddIngredientByFoodDto extends createZodDto(addIngredientByFoodRequestSchema) {}

export { MAX_FOOD_ID_LENGTH } from '../ingredients.schema.js';
