/**
 * Request DTO for `PATCH /api/v1/collections/{id}`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2). At least one field must be present — a PATCH that changes nothing is a client
 * bug, so it is a `400` rather than a silent success. `visibility` is the NARROWED enum here; the service
 * additionally re-asserts it at runtime, so the pipe is not the sole enforcement point (FR-010 / T140).
 */
import { createZodDto } from 'nestjs-zod';

import { updateCollectionRequestSchema } from '../collections.schema.js';

/** Body of `PATCH /api/v1/collections/{id}`. */
export class UpdateCollectionDto extends createZodDto(updateCollectionRequestSchema) {}
