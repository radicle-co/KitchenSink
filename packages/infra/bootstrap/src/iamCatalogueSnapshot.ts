/**
 * @module iamCatalogueSnapshot — the committed Service Authorization Reference snapshot (`manifests/iamCatalogue.json`),
 * read and checked once, for the code that must ask which actions only read.
 *
 * The execution policy splits every tag-gated grant into reads and writes by the reference's own access level, not by
 * a verb guess, so the generator and the guards that judge it (`readsUngated.test.ts`) share ONE authority.
 *
 * @sideEffect Reads the manifest from disk when first imported.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { IamCatalogue } from './iamCatalogue.js';

const catalogueSchema = z.object({
    services: z.record(
        z.string(),
        z.object({
            actions: z.array(z.string()),
            readOnly: z.array(z.string()),
            resources: z.record(z.string(), z.array(z.string())),
        }),
    ),
});

/** The committed snapshot. */
export const iamCatalogueSnapshot: IamCatalogue = catalogueSchema.parse(
    JSON.parse(readFileSync(fileURLToPath(new URL('../manifests/iamCatalogue.json', import.meta.url)), 'utf8')),
);
