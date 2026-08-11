/**
 * The identity service's own half of its contract configuration — the paths, the import allowlist and
 * the non-contract exclusions. The generation PROCEDURE lives once, in `@kitchensink/contract-gen`; only what
 * is genuinely specific to this service lives here.
 *
 * Kept separate from `generate.ts` so the service's `contract/__tests__` suite can assert against the very
 * config the generator runs with, rather than a restatement of it that could drift.
 */
import { resolve } from 'node:path';

import type { AllowedPackageImport, SchemaExclusion } from '@kitchensink/contract-gen';

/** Absolute path of the identity-service package root. */
export const SERVICE_ROOT = resolve(import.meta.dirname, '..');

/** Absolute path of the generated schema package. */
export const SCHEMA_PACKAGE_ROOT = resolve(SERVICE_ROOT, '../../schemas/identity');

/** The generated package's npm name. */
export const SCHEMA_PACKAGE_NAME = '@kitchensink/schema-identity';

/** The command that regenerates the package, quoted in every generated banner. */
export const REGENERATE_COMMAND = 'npm run contract:generate --workspace=@kitchensink/identity-service';

/**
 * Module specifiers an authored `*.schema.ts` may import.
 *
 * ZOD ONLY. Identity's wire shapes are small, self-contained scalars and objects; nothing here needs a
 * shared domain package, and `@kitchensink/identity-core` (the one candidate) carries display-name and
 * handle-sync POLICY rather than wire shapes. Before adding an entry, verify the candidate is a leaf whose
 * transitive runtime dependencies are safe to bundle into a React Native app — that property, not
 * convenience, is the admission test. `@commise/features-account`, `@commise/web` and `@commise/mobile` all
 * depend on the generated package, so a widening here reaches the mobile bundle.
 */
export const ALLOWED_PACKAGE_IMPORTS: readonly AllowedPackageImport[] = [
    {
        specifier: 'zod',
        why: 'The schema language itself. The generated package depends on it directly.',
    },
];

/** Authored `*.schema.ts` files that are deliberately NOT part of the wire contract. */
export const EXCLUDED_FILES: readonly SchemaExclusion[] = [
    {
        servicePath: 'src/config/env.schema.ts',
        why:
            "The PROCESS's environment-variable schema, not the API's. Publishing it would put this service's " +
            'env-var inventory — and its churn, which invalidates CONTRACT_HASH — into a package web and ' +
            'mobile depend on, for a shape no client can ever send or receive.',
    },
];

/** Path, relative to the service root, of the service-embedded `CONTRACT_HASH` stamp. */
export const SERVICE_STAMP_PATH = 'src/contract/contract-hash.ts';

/** Repo-relative path of this service, used in each generated file's `// Source:` provenance comment. */
export const SERVICE_PATH_PREFIX = 'packages/services/identity';

/** Human name of the contract, used in the `CONTRACT_HASH` doc comment. */
export const CONTRACT_DISPLAY_NAME = 'identity service';
