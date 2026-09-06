/**
 * `@kitchensink/db-schema-guard` — proving WHICH schema a process is running against.
 *
 * ## The failure this package removes
 *
 * A migration runner reads its own bundled `.sql` directory, diffs it against the `schema_migrations`
 * ledger, and returns `applied: []` when there is nothing to do. When the runner is a previous release's,
 * its directory does not contain the new migrations — so `applied: []` means "I have never heard of them"
 * and is byte-identical to "everything is already applied". Nothing downstream can tell those apart, which
 * is why ADR-0022 concluded that invoking the runner before the deploy that ships it is strictly worse than
 * the ordering bug it was meant to fix.
 *
 * The manifest makes the runner state which set it holds, so "nothing was pending" becomes provable: an
 * empty `applied[]` from a runner whose digest MATCHED the caller's expectation genuinely means the ledger
 * is current for exactly this set.
 *
 * ## Residual, stated rather than implied
 *
 * The manifest proves the runner's SQL matches the working tree. It does NOT prove the tree matches what
 * was reviewed — a migration edited after approval still applies. That is unchanged from before, but it is
 * now the only remaining silent path.
 */
export {
    EmptyMigrationSetError,
    SchemaBehindError,
    SchemaManifestMismatchError,
    isEmptyMigrationSetError,
    isSchemaBehindError,
    isSchemaManifestMismatchError,
} from './errors.js';
export type { SchemaBehindInput, SchemaManifestMismatchInput } from './errors.js';

export { digestManifest, formatManifest, isManifestSha, sha256Hex } from './manifest.js';
export type { ManifestEntry } from './manifest.js';

export { readMigrationManifest } from './manifestFile.js';
export type { MigrationManifest } from './manifestFile.js';

export { assertManifestMatches, assertSchemaCurrent, missingMigrations } from './assertions.js';
export type { AssertManifestMatchesOptions, AssertSchemaCurrentOptions } from './assertions.js';
