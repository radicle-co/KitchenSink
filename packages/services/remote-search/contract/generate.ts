/**
 * ENTRY POINT for `npm run contract:generate --workspace=@kitchensink/remote-search-service`. It composes the procedure
 * in `@kitchensink/contract-gen`, this service's `./config.js` and its `./openapi.js`, and prints the result.
 *
 * @sideEffect Reads the service's schema sources and WRITES `packages/schemas/remote-search` plus the service's own
 *             `CONTRACT_HASH` stamp.
 */
import { formatGenerationSummary, generateSchemaPackage } from '@kitchensink/contract-gen';

import {
    ALLOWED_PACKAGE_IMPORTS,
    CONTRACT_DISPLAY_NAME,
    REGENERATE_COMMAND,
    SCHEMA_PACKAGE_NAME,
    SCHEMA_PACKAGE_ROOT,
    SERVICE_PATH_PREFIX,
    SERVICE_ROOT,
    SERVICE_STAMP_PATH,
} from './config.js';
import { remoteSearchOpenApiDocument } from './openapi.js';

const result = await generateSchemaPackage({
    serviceRoot: SERVICE_ROOT,
    schemaPackageRoot: SCHEMA_PACKAGE_ROOT,
    schemaPackageName: SCHEMA_PACKAGE_NAME,
    servicePathPrefix: SERVICE_PATH_PREFIX,
    regenerateCommand: REGENERATE_COMMAND,
    contractDisplayName: CONTRACT_DISPLAY_NAME,
    allowedPackageImports: ALLOWED_PACKAGE_IMPORTS,
    serviceStampPath: SERVICE_STAMP_PATH,
    openApi: remoteSearchOpenApiDocument,
});

process.stdout.write(`${formatGenerationSummary(result, SCHEMA_PACKAGE_NAME)}\n`);
