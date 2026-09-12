/**
 * Request DTO for `POST /api/v1/ingredients/{id}/resolve`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts`
 * (CODING_STANDARDS §15.2). Bounded at `MAX_CANDIDATE_IDS`: the handler fans out per candidate, so an
 * unbounded array is an amplification vector rather than a generous API.
 */
import { createZodDto } from 'nestjs-zod';

import { resolveIngredientRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/{id}/resolve`. */
export class ResolveIngredientDto extends createZodDto(resolveIngredientRequestSchema) {}

export { MAX_CANDIDATE_IDS } from '../ingredients.schema.js';
