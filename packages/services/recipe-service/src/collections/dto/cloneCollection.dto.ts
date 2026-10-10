/**
 * Request DTO for `POST /api/v1/collections/{id}/clone` (FR-011).
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2). Both fields are optional, so the BODY is optional: the schema's `.default({})`
 * folds an absent body to "no overrides", which is why this route needs no bespoke pipe wrapper.
 */
import { createZodDto } from 'nestjs-zod';

import { cloneCollectionRequestSchema } from '../collections.schema.js';

/** Body of `POST /api/v1/collections/{id}/clone`. */
export class CloneCollectionDto extends createZodDto(cloneCollectionRequestSchema) {}
