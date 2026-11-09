/** Nest adapter over staff's pending-list query (`../publication.schema.ts`); see `publicationDecision.dto.ts`. */
import { createZodDto } from 'nestjs-zod';

import { publicationRequestsQuerySchema } from '../publication.schema.js';

/** Query of staff's pending list. */
export class PublicationRequestsQueryDto extends createZodDto(publicationRequestsQuerySchema) {}
