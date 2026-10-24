/**
 * Request DTO for `POST /api/v1/collections/{id}/pull-from-source` (W8-a.8).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2). The optional `previewedDiff` is the diff the client saw in the preview, echoed
 * back as the drift baseline; an absent body (folded to `{}` by the schema's `.default({})`) means apply
 * directly with no drift guard.
 */
import { createZodDto } from 'nestjs-zod';

import { pullFromSourceRequestSchema } from '../collections.schema.js';

/** Body of `POST /api/v1/collections/{id}/pull-from-source`. */
export class PullFromSourceDto extends createZodDto(pullFromSourceRequestSchema) {}
