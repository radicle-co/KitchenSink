/**
 * Request DTO for `POST /api/v1/ingredients` and `POST /api/v1/ingredients/by-name`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts`
 * (CODING_STANDARDS §15.2), so the shape the pipe enforces and the shape `@kitchensink/schema-recipe`
 * publishes are one object. The name is trimmed BEFORE the length bound is applied, so `'  '` is a `400`
 * rather than an ingredient literally named two spaces.
 */
import { createZodDto } from 'nestjs-zod';

import { createIngredientRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients` and `POST /api/v1/ingredients/by-name`. */
export class CreateIngredientDto extends createZodDto(createIngredientRequestSchema) {}

export { MAX_INGREDIENT_NAME_LENGTH } from '../ingredients.schema.js';
