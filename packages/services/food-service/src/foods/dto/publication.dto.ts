/**
 * Nest adapters over the publication wire contract (`../publication.schema.ts`). Each class is a thin `createZodDto`
 * wrapper, so the shape the pipe enforces and the shape `@kitchensink/schema-food` publishes are one object. Like every
 * DTO here it validates only under the global `ZodValidationPipe` (see `foods.dto.ts`).
 */
import { createZodDto } from 'nestjs-zod';

import {
    ownFoodListQuerySchema,
    publicationDecisionRequestSchema,
    publicationRequestsQuerySchema,
} from '../publication.schema.js';

/** Body of the staff decision. */
export class PublicationDecisionBodyDto extends createZodDto(publicationDecisionRequestSchema) {}

/** Query of staff's pending list. */
export class PublicationRequestsQueryDto extends createZodDto(publicationRequestsQuerySchema) {}

/** Query of the author's own-foods list. */
export class OwnFoodListQueryDto extends createZodDto(ownFoodListQuerySchema) {}
