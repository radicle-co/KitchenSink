/** Body of `PUT /api/v1/import/:importId/items`. A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { putImportItemsRequestSchema } from '../../recipes/import.schema.js';

/** Body of `PUT /api/v1/import/:importId/items`. */
export class PutImportItemsDto extends createZodDto(putImportItemsRequestSchema) {}
