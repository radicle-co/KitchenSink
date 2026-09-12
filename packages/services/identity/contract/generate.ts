/**
 * ENTRY POINT for `npm run contract:generate --workspace=@kitchensink/identity-service`.
 *
 * Everything substantive lives elsewhere on purpose: the procedure in `@kitchensink/contract-gen`, this
 * service's paths/allowlist/exclusions in `./config.js`, and its route declarations in `./openapi.js`. This file
 * exists only to compose them and print the result, so there is nothing here to drift.
 *
 * @sideEffect Reads the service's schema sources and WRITES `packages/schemas/identity` plus the service's own
 *             `CONTRACT_HASH` stamp.
 */
import { formatGenerationSummary, generateSchemaPackage } from '@kitchensink/contract-gen';

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
import { identityOpenApiDocument } from './openapi.js';

const result = await generateSchemaPackage({
    serviceRoot: SERVICE_ROOT,
    schemaPackageRoot: SCHEMA_PACKAGE_ROOT,
    schemaPackageName: SCHEMA_PACKAGE_NAME,
    servicePathPrefix: SERVICE_PATH_PREFIX,
    regenerateCommand: REGENERATE_COMMAND,
    contractDisplayName: CONTRACT_DISPLAY_NAME,
    allowedPackageImports: ALLOWED_PACKAGE_IMPORTS,
    excludeFiles: EXCLUDED_FILES,
    serviceStampPath: SERVICE_STAMP_PATH,
    openApi: identityOpenApiDocument,
});

process.stdout.write(`${formatGenerationSummary(result, SCHEMA_PACKAGE_NAME)}\n`);
