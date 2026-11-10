/**
 * Nest adapter over the staff decision body (`../publication.schema.ts`): a thin `createZodDto` wrapper, so the shape
 * the pipe enforces and the shape `@kitchensink/schema-food` publishes are one object. Like every DTO here it validates
 * only under the global `ZodValidationPipe` (see `foods.dto.ts`).
 */
import { createZodDto } from 'nestjs-zod';

import { publicationDecisionRequestSchema } from '../publication.schema.js';

/** Body of the staff decision. */
export class PublicationDecisionBodyDto extends createZodDto(publicationDecisionRequestSchema) {}
