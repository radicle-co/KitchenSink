/** Body of `POST /api/v1/import/:importId/advance`: nothing. A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { advanceImportRequestSchema } from '../../recipes/import.schema.js';

/** Body of `POST /api/v1/import/:importId/advance`: nothing. */
export class AdvanceImportDto extends createZodDto(advanceImportRequestSchema) {}
