/**
 * Request DTO for `POST /api/v1/recipe-parse-jobs/:id/withdraw-lines`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../parseJobs.schema.ts` — see
 * `createParseJob.dto.ts` for the pipe caveat that applies to every `createZodDto` class.
 */
import { createZodDto } from 'nestjs-zod';

import { withdrawParseJobLinesRequestSchema } from '../parseJobs.schema.js';

/** Body of `POST /api/v1/recipe-parse-jobs/:id/withdraw-lines`. */
export class WithdrawParseJobLinesDto extends createZodDto(withdrawParseJobLinesRequestSchema) {}
