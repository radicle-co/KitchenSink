/**
 * Request DTO for `POST /api/v1/recipe-parse-jobs` (plan U9).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../parseJobs.schema.ts` (CODING_STANDARDS
 * §15.2), so the shape the pipe enforces and the shape `@kitchensink/schema-recipe` publishes are ONE
 * object. ⚠️ A `createZodDto` class carries NO `class-validator` metadata — it validates ONLY under
 * `nestjs-zod`'s `ZodValidationPipe`, which the controller binds with `@UsePipes`.
 */
import { createZodDto } from 'nestjs-zod';

import { createParseJobRequestSchema } from '../parseJobs.schema.js';

/** Body of `POST /api/v1/recipe-parse-jobs`. */
export class CreateParseJobDto extends createZodDto(createParseJobRequestSchema) {}
