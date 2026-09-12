/**
 * The remote search service's own half of its contract configuration: the paths and the import allowlist. The
 * generation procedure lives once, in `@kitchensink/contract-gen`.
 *
 * Kept apart from `generate.ts` so `contract/__tests__` asserts against the config the generator runs with.
 */
import { resolve } from 'node:path';

import type { AllowedPackageImport } from '@kitchensink/contract-gen';

/** Absolute path of the service package root. */
export const SERVICE_ROOT = resolve(import.meta.dirname, '..');

/** Absolute path of the generated schema package. */
export const SCHEMA_PACKAGE_ROOT = resolve(SERVICE_ROOT, '../../schemas/remote-search');

/** The generated package's npm name. */
export const SCHEMA_PACKAGE_NAME = '@kitchensink/schema-remote-search';

/** The command that regenerates the package, quoted in every generated banner. */
export const REGENERATE_COMMAND = 'npm run contract:generate --workspace=@kitchensink/remote-search-service';

/**
 * Module specifiers an authored `*.schema.ts` may import: zod only. The one consumer is food-service, which must not
 * reach this service's dependencies through the copied package.
 */
export const ALLOWED_PACKAGE_IMPORTS: readonly AllowedPackageImport[] = [
    {
        specifier: 'zod',
        why: 'The schema language itself. The generated package depends on it directly.',
    },
];

/** Path, relative to the service root, of the service-embedded `CONTRACT_HASH` stamp. */
export const SERVICE_STAMP_PATH = 'src/contract/contractHash.ts';

/** Repo-relative path of this service, used in each generated file's `// Source:` provenance comment. */
export const SERVICE_PATH_PREFIX = 'packages/services/remote-search';

/** Human name of the contract, used in the `CONTRACT_HASH` doc comment. */
export const CONTRACT_DISPLAY_NAME = 'remote search service';
