/**
 * Request DTO for `POST /api/v1/collections/{id}/recipes`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2). Carries only the recipe id; the collection comes from the path and the owner
 * from the verified principal. The service still re-checks that the caller may VIEW the recipe — a
 * well-formed id is not an authorization.
 */
import { createZodDto } from 'nestjs-zod';

import { addRecipeToCollectionRequestSchema } from '../collections.schema.js';

/** Body of `POST /api/v1/collections/{id}/recipes`. */
export class AddRecipeToCollectionDto extends createZodDto(addRecipeToCollectionRequestSchema) {}
