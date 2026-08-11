/**
 * THE RECIPE CONTRACT'S GENERATION ENTRY POINT — configuration and a `main`, and nothing else.
 *
 * The PROCEDURE lives in `@kitchensink/contract-gen`: discovering the authored `*.schema.ts` files, enforcing
 * the import restriction, flattening and copying them, stamping `CONTRACT_HASH` into both sides, and writing
 * the derived `openapi.yaml`. This file holds only what is genuinely recipe-specific — where the two package
 * roots are, what the regenerate command is, which package imports are admissible inside an authored schema,
 * and the document's route table (`./openapi.js`).
 *
 * That split replaced ~250 lines of logic that lived here and was, line for line, the same logic the food and
 * identity services needed. Two copies of "which imports may cross into the leaf package" is exactly the
 * duplication §15 exists to forbid, and the more dangerous kind: the two copies would drift silently and the
 * weaker one would decide what shipped.
 *
 * DIRECTION OF DERIVATION, which must never be inverted: the service AUTHORS zod; this run COPIES it into the
 * leaf package; the copy is committed and guarded by regenerate-and-diff in CI. `recipe-service` does not
 * import the generated package's schemas — the leaf is downstream.
 *
 * RUN IT WITH `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * `tsx` is a correct host even though it cannot emit `design:paramtypes`: that limitation only breaks NestJS
 * dependency injection, and this script never boots the application. It imports the authored zod as plain
 * values (which is what lets the OpenAPI document be derived from the real schemas rather than a description
 * of them), checks the sources, and writes files.
 *
 * @sideEffect Reads the service's schema sources and WRITES the schema package plus a hash stamp.
 */
import { resolve } from 'node:path';

import { formatGenerationSummary, generateSchemaPackage } from '@kitchensink/contract-gen';
import type { ContractGenerationConfig } from '@kitchensink/contract-gen';

import { buildRecipeOpenApiDocument } from './openapi.js';

/** Absolute path of the recipe-service package root. */
const SERVICE_ROOT = resolve(import.meta.dirname, '..');

/** The generated package this run publishes. */
const SCHEMA_PACKAGE_NAME = '@kitchensink/schema-recipe';

/**
 * The recipe service's contract configuration.
 *
 * ⚠️ `allowedPackageImports` IS THE LOAD-BEARING ENTRY. An authored `*.schema.ts` is copied verbatim into a
 * package that `@commise/web` and `@commise/mobile` depend on, so admitting a specifier here is a promise that
 * its whole transitive runtime graph is safe for a React Native bundle. Widening it is a reviewed decision,
 * never an incidental edit.
 */
const config: Omit<ContractGenerationConfig, 'openApi'> = {
    serviceRoot: SERVICE_ROOT,
    schemaPackageRoot: resolve(SERVICE_ROOT, '../../schemas/recipe'),
    schemaPackageName: SCHEMA_PACKAGE_NAME,
    servicePathPrefix: 'packages/services/recipe-service',
    regenerateCommand: 'npm run contract:generate --workspace=@kitchensink/recipe-service',
    contractDisplayName: 'recipe service',
    serviceStampPath: 'src/contract/contract-hash.ts',
    allowedPackageImports: [
        {
            specifier: 'zod',
            why: 'The schema language itself. The generated package depends on it directly.',
        },
        {
            // RECONCILIATION, flagged for the owner: the locked rules say a `*.schema.ts` may import "only zod
            // and other *.schema.ts files", and ALSO say to compose `recipe-core`'s existing zod rather than
            // author a second schema for a shape it already owns. Those two rules cannot both hold literally —
            // composing recipe-core requires importing it. This entry resolves the conflict in favour of the
            // no-duplication rule, which is the one with teeth: re-declaring `Recipe`/`RecipeDetail`/
            // `PaginatedResponse` would manufacture precisely the drift this seam exists to prevent.
            //
            // It is safe on the same test every other entry must pass: `@kitchensink/recipe-core` is itself a
            // leaf whose ONLY runtime dependency is `zod` (verified in its package.json), so admitting it pulls
            // no server graph into web or mobile.
            specifier: '@kitchensink/recipe-core',
            why: 'Zod-only leaf that already owns the recipe DOMAIN schemas; composed, never re-declared.',
        },
    ],
};

/**
 * Generate the schema package.
 *
 * @sideEffect Deletes and rewrites the generated directories, writes two hash stamps and `openapi.yaml`.
 */
async function main(): Promise<void> {
    const result = await generateSchemaPackage({ ...config, openApi: buildRecipeOpenApiDocument() });

    process.stdout.write(`${formatGenerationSummary(result, SCHEMA_PACKAGE_NAME)}\n`);
}

await main();
