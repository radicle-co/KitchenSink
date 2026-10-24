/**
 * Request DTO for `PATCH /api/v1/recipe-parse-jobs/:id/lines/:lineIndex` (plan U9).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../parseJobs.schema.ts` — see
 * `createParseJob.dto.ts` for the pipe caveat that applies to every `createZodDto` class.
 */
import { createZodDto } from 'nestjs-zod';

import { editParseJobLineRequestSchema } from '../parseJobs.schema.js';

/** Body of `PATCH /api/v1/recipe-parse-jobs/:id/lines/:lineIndex`. */
export class EditParseJobLineDto extends createZodDto(editParseJobLineRequestSchema) {}
