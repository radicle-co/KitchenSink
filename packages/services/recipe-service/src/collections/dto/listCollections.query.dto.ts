/**
 * Query DTO for `GET /api/v1/collections`.
 *
 * A thin `nestjs-zod` adapter over the AUTHORED contract in `../collections.schema.ts`
 * (CODING_STANDARDS §15.2). The schema coerces (a query bag is strings on the wire) and supplies the
 * `page: 1` / `pageSize: 20` defaults, so the handler receives numbers and the service needs no fallback
 * of its own.
 */
import { createZodDto } from 'nestjs-zod';

import { listCollectionsQuerySchema } from '../collections.schema.js';

/** Query of `GET /api/v1/collections`. */
export class ListCollectionsQueryDto extends createZodDto(listCollectionsQuerySchema) {}
