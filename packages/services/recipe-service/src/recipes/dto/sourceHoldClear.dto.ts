/**
 * Request DTO for `POST /api/v1/recipes/{id}/source-correction/hold-clear` (ADR-0106): a thin `nestjs-zod` adapter over the
 * AUTHORED contract in `../recipes.schema.ts` (CODING_STANDARDS section 15.2). The grant is not decided here: the body is valid
 * for any caller, and the policy answers `403` for one without the staff grant.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata; see `createRecipe.dto.ts`.
 */
import { createZodDto } from 'nestjs-zod';

import { sourceHoldClearRequestSchema } from '../recipes.schema.js';

/** Body of `POST /api/v1/recipes/{id}/source-correction/hold-clear`. */
export class SourceHoldClearDto extends createZodDto(sourceHoldClearRequestSchema) {}
