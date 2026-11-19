/** Body of `POST /api/v1/import/:importId/cursor`. A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { importCursorRequestSchema } from '../../recipes/import.schema.js';

/** Body of `POST /api/v1/import/:importId/cursor`. */
export class ImportCursorDto extends createZodDto(importCursorRequestSchema) {}
