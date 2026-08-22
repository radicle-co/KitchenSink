/**
 * Request DTO for `POST /api/v1/ingredients/corrections` (plan U14 / R19, R20).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../ingredients.schema.ts`
 * (CODING_STANDARDS §15.2), so the shape the controller-scoped `ZodValidationPipe` enforces and the shape
 * `@kitchensink/schema-recipe` publishes are ONE object rather than two that happen to agree.
 *
 * ⚠️ A `createZodDto` class carries NO `class-validator` metadata. It is validated ONLY by `nestjs-zod`'s
 * pipe, which `IngredientsController` binds with `@UsePipes` — under Nest's own `ValidationPipe` this DTO
 * would validate NOTHING while looking correctly wired.
 *
 * There is deliberately no `scope` and no `authorId` field: reach is DECIDED by `evaluateMappingWrite` from
 * the caller's signed grants, never declared, and the author is the verified principal.
 */
import { createZodDto } from 'nestjs-zod';

import { recordCorrectionRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/corrections`. */
export class RecordCorrectionDto extends createZodDto(recordCorrectionRequestSchema) {}
