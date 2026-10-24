/**
 * T036 — request DTO for `POST /api/v1/recipes/{recipeId}/photos/confirm`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../photos.schema.ts` (CODING_STANDARDS §15.2),
 * so the validated shape and the published shape are the same object.
 *
 * Echoes back the object `key` the client received from `upload-url` and uploaded to. The service validates
 * the object itself (magic bytes + HEAD size) and that the key is scoped to the owner + recipe.
 * `contentType` is accepted for contract conformance but is NOT trusted: the server authoritatively detects
 * the stored content type from the object's bytes and never persists this client-declared value.
 */
import { createZodDto } from 'nestjs-zod';

import { confirmPhotoRequestSchema } from '../photos.schema.js';

/** Body of `POST /api/v1/recipes/{recipeId}/photos/confirm`. */
export class ConfirmPhotoDto extends createZodDto(confirmPhotoRequestSchema) {}
