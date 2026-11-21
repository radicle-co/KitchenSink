/**
 * Query DTO for `GET /api/v1/recipes/{id}/source-correction` (ADR-0100): a thin `nestjs-zod` adapter over the AUTHORED query
 * schema in `../recipes.schema.ts`. The grant is not decided here; the policy answers `403` for a caller without it.
 */
import { createZodDto } from 'nestjs-zod';

import { sourceCorrectionPreviewQuerySchema } from '../recipes.schema.js';

/** Query of `GET /api/v1/recipes/{id}/source-correction`. */
export class SourceCorrectionPreviewQueryDto extends createZodDto(sourceCorrectionPreviewQuerySchema) {}
