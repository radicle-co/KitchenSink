/**
 * The `:ordinal` path parameter of the item routes: digits only, then an item position (`0 .. int4 max`).
 *
 * `ParseIntPipe` alone accepts a number past `int4`, which Postgres would answer with a `500`. Not a wire contract (it is a
 * path segment, not a body), so it is authored here, over the published ceiling.
 */
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MAX_IMPORT_ITEMS } from '../../recipes/import.schema.js';

const importOrdinalParamSchema = z.object({
    ordinal: z
        .string()
        .regex(/^\d{1,10}$/u)
        .transform(Number)
        .pipe(
            z
                .number()
                .int()
                .max(MAX_IMPORT_ITEMS - 1),
        ),
});

/** The `:ordinal` path parameter. */
export class ImportOrdinalParamDto extends createZodDto(importOrdinalParamSchema) {}
