/**
 * T036 — request DTO for `POST /api/v1/recipes/{recipeId}/photos/upload-url`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../photos.schema.ts` (CODING_STANDARDS §15.2).
 * The zod schema is the definition; this class only makes it something Nest's DI/pipe layer can name, so
 * the shape the service validates and the shape `@kitchensink/schema-recipe` publishes are one object
 * rather than two that can drift. There is no second set of rules to keep in step here — that is the point.
 *
 * The allowlist decision (jpeg/png/webp → `415`) and the 5 MB pre-check (→ `413`) stay in
 * `PhotosService.createUploadUrl`: they are status-bearing and the pipe runs before the controller.
 * See `recipePhotoContentTypeSchema` for the full reasoning.
 */
import { createZodDto } from 'nestjs-zod';

import { createPhotoUploadRequestSchema } from '../photos.schema.js';

/** Body of `POST /api/v1/recipes/{recipeId}/photos/upload-url`. */
export class CreatePhotoUploadDto extends createZodDto(createPhotoUploadRequestSchema) {}
