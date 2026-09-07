/**
 * Request DTO for `PATCH /api/v1/recipes/{id}` (partial update, optimistic concurrency).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS §15.2).
 * `expectedVersion` is REQUIRED (the client's last-known `currentVersion`, used for the T033
 * optimistic-concurrency check); every content field is optional. `visibility` is deliberately absent — it is
 * set through the dedicated visibility endpoint, and the service has always stripped it here.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { updateRecipeRequestSchema } from '../recipes.schema.js';

/** Body of `PATCH /api/v1/recipes/{id}`. */
export class UpdateRecipeDto extends createZodDto(updateRecipeRequestSchema) {}
