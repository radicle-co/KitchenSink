/** Nest adapter over the author's own-foods list query (`../publication.schema.ts`); see `publicationDecision.dto.ts`. */
import { createZodDto } from 'nestjs-zod';

import { ownFoodListQuerySchema } from '../publication.schema.js';

/** Query of the author's own-foods list. */
export class OwnFoodListQueryDto extends createZodDto(ownFoodListQuerySchema) {}
