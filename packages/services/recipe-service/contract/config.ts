/**
 * The recipe service's own half of its contract configuration — the paths, the import allowlist and the
 * non-contract exclusions. The generation PROCEDURE lives once, in `@kitchensink/contract-gen`; only what is
 * genuinely specific to this service lives here.
 *
 * Kept separate from `generate.ts` so `contract/__tests__/contract.test.ts` can assert against the very config
 * the generator runs with, rather than a restatement of it that could drift. Food's `contract/config.ts` is the
 * sibling of this file and the two are deliberately shaped alike.
 */
import { resolve } from 'node:path';

import type { AllowedPackageImport, SchemaExclusion } from '@kitchensink/contract-gen';

/** Absolute path of the recipe-service package root. */
export const SERVICE_ROOT = resolve(import.meta.dirname, '..');

/** Absolute path of the generated schema package. */
export const SCHEMA_PACKAGE_ROOT = resolve(SERVICE_ROOT, '../../schemas/recipe');

/** The generated package's npm name. */
export const SCHEMA_PACKAGE_NAME = '@kitchensink/schema-recipe';

/** The command that regenerates the package, quoted in every generated banner. */
export const REGENERATE_COMMAND = 'npm run contract:generate --workspace=@kitchensink/recipe-service';

/**
 * Module specifiers an authored `*.schema.ts` may import.
 *
 * ⚠️ THIS IS THE LOAD-BEARING ENTRY. An authored `*.schema.ts` is copied verbatim into a package
 * `@commise/web` and `@commise/mobile` depend on, so admitting a specifier here is a promise that its whole
 * transitive runtime graph is safe for a React Native bundle. Widening it is a reviewed decision, never an
 * incidental edit.
 */
export const ALLOWED_PACKAGE_IMPORTS: readonly AllowedPackageImport[] = [
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
];

/**
 * Authored `*.schema.ts` files that are deliberately NOT part of the wire contract.
 *
 * EMPTY, and that is a fact about this service rather than an oversight: its process-environment schema is not
 * a `*.schema.ts` at all (it lives in `src/config/config.types.ts`), so there is nothing here to exclude. Food
 * excludes `src/config/env.schema.ts` for exactly that reason and this service has no counterpart — asserted in
 * `contract/__tests__/contract.test.ts` so the day one appears, the exclusion decision is forced rather than
 * defaulted.
 */
export const EXCLUDED_FILES: readonly SchemaExclusion[] = [];

/** Path, relative to the service root, of the service-embedded `CONTRACT_HASH` stamp. */
export const SERVICE_STAMP_PATH = 'src/contract/contract-hash.ts';

/** Repo-relative path of this service, used in each generated file's `// Source:` provenance comment. */
export const SERVICE_PATH_PREFIX = 'packages/services/recipe-service';

/** Human name of the contract, used in the `CONTRACT_HASH` doc comment. */
export const CONTRACT_DISPLAY_NAME = 'recipe service';
