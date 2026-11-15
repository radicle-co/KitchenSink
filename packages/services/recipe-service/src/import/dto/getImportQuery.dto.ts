/** Query of `GET /api/v1/import/:importId`. A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { getImportQuerySchema } from '../../recipes/import.schema.js';

/** Query of `GET /api/v1/import/:importId`. */
export class GetImportQueryDto extends createZodDto(getImportQuerySchema) {}
