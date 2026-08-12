/**
 * THE RECIPE CONTRACT'S GENERATION ENTRY POINT — a `main` over `./config.js`, and nothing else.
 *
 * The PROCEDURE lives in `@kitchensink/contract-gen`: discovering the authored `*.schema.ts` files, enforcing
 * the import restriction, flattening and copying them, stamping `CONTRACT_HASH` into both sides, and writing
 * the derived `openapi.yaml`. What is genuinely recipe-specific lives in two siblings — `./config.js` (the
 * package roots, the regenerate command, the import allowlist, the exclusions) and `./openapi.js` (the
 * document's route table).
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
import { formatGenerationSummary, generateSchemaPackage } from '@kitchensink/contract-gen';
import type { ContractGenerationConfig } from '@kitchensink/contract-gen';

import {
    ALLOWED_PACKAGE_IMPORTS,
    CONTRACT_DISPLAY_NAME,
    EXCLUDED_FILES,
    REGENERATE_COMMAND,
    SCHEMA_PACKAGE_NAME,
    SCHEMA_PACKAGE_ROOT,
    SERVICE_PATH_PREFIX,
    SERVICE_ROOT,
    SERVICE_STAMP_PATH,
} from './config.js';
import { buildRecipeOpenApiDocument } from './openapi.js';

/**
 * The recipe service's contract configuration, assembled from `./config.js`.
 *
 * The values live in that module rather than here so `contract/__tests__/contract.test.ts` asserts against the
 * VERY config this run uses — a restatement in the suite could drift from the one that ships.
 */
const config: Omit<ContractGenerationConfig, 'openApi'> = {
    serviceRoot: SERVICE_ROOT,
    schemaPackageRoot: SCHEMA_PACKAGE_ROOT,
    schemaPackageName: SCHEMA_PACKAGE_NAME,
    servicePathPrefix: SERVICE_PATH_PREFIX,
    regenerateCommand: REGENERATE_COMMAND,
    contractDisplayName: CONTRACT_DISPLAY_NAME,
    serviceStampPath: SERVICE_STAMP_PATH,
    allowedPackageImports: ALLOWED_PACKAGE_IMPORTS,
    excludeFiles: EXCLUDED_FILES,
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
