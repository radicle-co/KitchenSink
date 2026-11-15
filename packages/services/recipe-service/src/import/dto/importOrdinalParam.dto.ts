/** The `:ordinal` path parameter of the item routes, over the AUTHORED schema (ADR-0014): digits, then an item position. */
import { createZodDto } from 'nestjs-zod';

import { importOrdinalParamsSchema } from '../../recipes/import.schema.js';

/** The `:ordinal` path parameter. */
export class ImportOrdinalParamDto extends createZodDto(importOrdinalParamsSchema) {}
