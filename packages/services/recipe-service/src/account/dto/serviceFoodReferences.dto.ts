/**
 * Request DTO for `POST /api/v1/internal/account/food-references` (plan U18) — a thin `nestjs-zod`
 * adapter over the AUTHORED contract in `../account.schema.ts` (CODING_STANDARDS §15.2). Validated by the
 * controller-scoped/global `ZodValidationPipe`, like every other DTO.
 */
import { createZodDto } from 'nestjs-zod';

import { serviceFoodReferencesRequestSchema } from '../account.schema.js';

/** Body: the erased owner's authored food ids to check. */
export class ServiceFoodReferencesDto extends createZodDto(serviceFoodReferencesRequestSchema) {}
