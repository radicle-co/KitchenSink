/**
 * T036 — request DTO for `PATCH /api/v1/recipes/{recipeId}/photos/reorder`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../photos.schema.ts` (CODING_STANDARDS §15.2).
 * Carries the recipe's photo ids in their desired display order; the DAL rewrites each row's `sortOrder` to
 * its index in this array.
 */
import { createZodDto } from 'nestjs-zod';

import { reorderPhotosRequestSchema } from '../photos.schema.js';

/** Body of `PATCH /api/v1/recipes/{recipeId}/photos/reorder`. */
export class ReorderPhotosDto extends createZodDto(reorderPhotosRequestSchema) {}
