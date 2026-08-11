/**
 * Request DTO for `POST /api/v1/collections`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2), so the shape the pipe enforces and the shape `@kitchensink/schema-recipe`
 * publishes are ONE object rather than two that happen to agree. `ownerId` is not a field: ownership comes
 * from the verified principal, and zod strips the key if a caller sends one anyway.
 */
import { createZodDto } from 'nestjs-zod';

import { createCollectionRequestSchema } from '../collections.schema.js';

/** Body of `POST /api/v1/collections`. */
export class CreateCollectionDto extends createZodDto(createCollectionRequestSchema) {}

export { MAX_COLLECTION_DESCRIPTION_LENGTH, MAX_COLLECTION_NAME_LENGTH } from '../collections.schema.js';
