/**
 * Query DTO for `GET /api/v1/ingredients/by-name/proposals`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts` (CODING_STANDARDS §15.2), so the
 * shape the pipe enforces and the shape `@kitchensink/schema-recipe` publishes are one object. The name is trimmed
 * before its length bound, so a blank `name` is a `400`.
 */
import { createZodDto } from 'nestjs-zod';

import { ingredientNameProposalsQuerySchema } from '../ingredients.schema.js';

/** Query of `GET /api/v1/ingredients/by-name/proposals`. */
export class IngredientNameProposalsQueryDto extends createZodDto(ingredientNameProposalsQuerySchema) {}
