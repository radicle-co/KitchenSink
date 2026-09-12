/**
 * The two refusals the manifest makes possible.
 *
 * {@link assertManifestMatches} is the RUNNER's: it will not report a clean run unless the migration set it
 * holds is the one the caller expected. {@link assertSchemaCurrent} is the CONSUMER's: a process that reads
 * the schema will not start against a database that is behind its own release.
 */
import { SchemaBehindError, SchemaManifestMismatchError } from './errors.js';
import { isManifestSha } from './manifest.js';

/** Options for {@link assertManifestMatches}. */
export interface AssertManifestMatchesOptions {
    /** Which schema this is — used only to make the failure readable in a deploy log. */
    readonly label: string;
    /** The manifest digest the caller computed from the release being deployed. */
    readonly expected: string;
    /** The manifest digest computed from the migration set actually held. */
    readonly actual: string;
    /** The migration filenames actually held, in apply order. */
    readonly migrations: readonly string[];
}

/**
 * Refuse to proceed unless the migration set held is the set expected.
 *
 * ⛔ A malformed expectation is rejected rather than compared. Comparing against an empty or truncated
 * digest would "fail closed" for the wrong reason, reporting a stale runner when the real fault is a caller
 * that computed nothing — and the two want opposite repairs.
 *
 * @param options - The label, the two digests, and the set held.
 * @throws {Error} when `expected` is not a sha256 digest.
 * @throws {SchemaManifestMismatchError} when the digests differ.
 */
export function assertManifestMatches(options: AssertManifestMatchesOptions): void {
    const { label, expected, actual, migrations } = options;

    if (!isManifestSha(expected)) {
        throw new Error(
            `[${label}] the expected migration manifest '${expected}' is not a sha256 digest — the caller ` +
                'proved nothing about which migration set it wanted, so this run cannot be certified',
        );
    }

    if (expected !== actual) {
        throw new SchemaManifestMismatchError({ label, expected, actual, migrations });
    }
}

/** Options for {@link assertSchemaCurrent}. */
export interface AssertSchemaCurrentOptions {
    /** Which consumer is refusing — used only to make the failure readable. */
    readonly label: string;
    /** The migration names this release requires, in apply order. */
    readonly expected: readonly string[];
    /** Reads the names recorded in the target database's `schema_migrations` ledger. */
    readonly readApplied: () => Promise<readonly string[]>;
}

/**
 * The expected migrations a database has not applied, in expected order.
 *
 * ⛔ A database that is AHEAD is not an error. Under expand-first migrations a contracting change ships a
 * release LATER than the code that stopped reading the column, so "ahead" is the normal state during every
 * rollout; treating it as a fault would fail deploys for doing the right thing.
 *
 * @param expected - The migration names this release requires.
 * @param applied - The migration names the database has recorded.
 * @returns The expected names not present in `applied`.
 */
export function missingMigrations(expected: readonly string[], applied: readonly string[]): string[] {
    const recorded = new Set(applied);

    return expected.filter((name) => !recorded.has(name));
}

/**
 * Refuse to proceed against a database that is behind this release.
 *
 * ⛔ A read failure PROPAGATES. An unreadable ledger is not an empty ledger, and swallowing the error would
 * turn "the database is unreachable" into the confident, wrong diagnosis "the database is behind".
 *
 * @param options - The label, the required migrations, and the ledger reader.
 * @throws {Error} when `expected` is empty — an assertion over no migrations asserts nothing.
 * @throws {SchemaBehindError} when any required migration is unapplied.
 * @sideEffect Calls `readApplied`, which reads the database.
 */
export async function assertSchemaCurrent(options: AssertSchemaCurrentOptions): Promise<void> {
    const { label, expected, readApplied } = options;

    if (expected.length === 0) {
        throw new Error(
            `[${label}] cannot assert schema currency against no migrations — an empty expectation would ` +
                'report a healthy start against a completely empty database',
        );
    }

    const missing = missingMigrations(expected, await readApplied());

    if (missing.length > 0) {
        throw new SchemaBehindError({ label, missing });
    }
}
