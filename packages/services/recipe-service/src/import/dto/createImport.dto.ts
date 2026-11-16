/** Body of `POST /api/v1/import`. A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { createImportRequestSchema } from '../../recipes/import.schema.js';

/** Body of `POST /api/v1/import`. */
export class CreateImportDto extends createZodDto(createImportRequestSchema) {}
