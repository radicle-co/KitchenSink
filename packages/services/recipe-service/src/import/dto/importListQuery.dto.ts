/** Query of the paged import reads (`GET /api/v1/import`, `/flagged`, `/to-check`). A thin `nestjs-zod` adapter over the AUTHORED contract in `../../recipes/import.schema.ts` (ADR-0014): one object, not a copy. */
import { createZodDto } from 'nestjs-zod';

import { importListQuerySchema } from '../../recipes/import.schema.js';

/** Query of the paged import reads (`GET /api/v1/import`, `/flagged`, `/to-check`). */
export class ImportListQueryDto extends createZodDto(importListQuerySchema) {}
