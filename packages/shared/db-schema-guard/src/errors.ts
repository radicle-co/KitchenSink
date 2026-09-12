/**
 * The failures this package exists to make LOUD.
 *
 * Each one follows the repository's custom-error convention (extend `Error`, restore the prototype,
 * publish a matching `is*` guard), and each carries its evidence as FIELDS rather than only in the
 * message — a caller that has to regex an error string to report it will eventually report it wrong.
 */

/** Options for {@link SchemaManifestMismatchError}. */
export interface SchemaManifestMismatchInput {
    /** Which schema this is — used only to make the message readable in a deploy log. */
    readonly label: string;
    /** The manifest digest the CALLER computed from the release being deployed. */
    readonly expected: string;
    /** The manifest digest the RUNNER computed from the migration set it actually holds. */
    readonly actual: string;
    /** The migration filenames the runner holds, in apply order. */
    readonly migrations: readonly string[];
}

/**
 * The migration set a runner holds is not the set the caller expected.
 *
 * ⛔ In practice this always means the runner is a PREVIOUS release's — the bundle ships with the deploy,
 * so anything that invokes the runner before that deploy lands invokes the old one. Before this error
 * existed, that case returned `applied: []` and was indistinguishable from "nothing was pending".
 */
export class SchemaManifestMismatchError extends Error {
    /** The manifest digest the caller expected. */
    public readonly expected: string;
    /** The manifest digest the runner actually holds. */
    public readonly actual: string;
    /** The migration filenames the runner holds, in apply order. */
    public readonly migrations: readonly string[];

    public constructor(input: SchemaManifestMismatchInput) {
        super(
            `[${input.label}] migration manifest mismatch — the caller expected ${input.expected} but this ` +
                `runner holds ${input.actual}. The set it holds is: ${input.migrations.join(', ')}. ` +
                'A runner carrying a different set cannot prove that nothing was pending.',
        );
        this.name = 'SchemaManifestMismatchError';
        this.expected = input.expected;
        this.actual = input.actual;
        this.migrations = [...input.migrations];
        Object.setPrototypeOf(this, SchemaManifestMismatchError.prototype);
    }
}

/**
 * Type guard for {@link SchemaManifestMismatchError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a manifest mismatch.
 */
export function isSchemaManifestMismatchError(value: unknown): value is SchemaManifestMismatchError {
    return value instanceof SchemaManifestMismatchError;
}

/** Options for {@link SchemaBehindError}. */
export interface SchemaBehindInput {
    /** Which consumer refused to proceed. */
    readonly label: string;
    /** The migrations this release requires that the database has not applied, in expected order. */
    readonly missing: readonly string[];
}

/**
 * A process that reads the schema started against a database that has not caught up to its release.
 *
 * The migrations are named because the operator's next question is always "which one", and the answer
 * distinguishes an ordering bug in the pipeline from a migration that failed.
 */
export class SchemaBehindError extends Error {
    /** The migrations this release requires that the database has not applied. */
    public readonly missing: readonly string[];

    public constructor(input: SchemaBehindInput) {
        super(
            `[${input.label}] refusing to run against a database that is behind this release — ` +
                `${input.missing.length} migration(s) not applied: ${input.missing.join(', ')}`,
        );
        this.name = 'SchemaBehindError';
        this.missing = [...input.missing];
        Object.setPrototypeOf(this, SchemaBehindError.prototype);
    }
}

/**
 * Type guard for {@link SchemaBehindError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a behind-schema refusal.
 */
export function isSchemaBehindError(value: unknown): value is SchemaBehindError {
    return value instanceof SchemaBehindError;
}

/**
 * A migrations directory holds no `.sql` at all.
 *
 * ⛔ Refused rather than digested. `sha256('')` is a perfectly well-formed digest, so an empty bundle would
 * AGREE with an empty tree and the manifest would certify a runner carrying no migrations whatsoever —
 * reintroducing, one layer up, the silent success this package exists to remove.
 */
export class EmptyMigrationSetError extends Error {
    /** The directory that held no `.sql` files. */
    public readonly directory: string;

    public constructor(directory: string) {
        super(`No .sql migrations found in ${directory} — an empty migration set cannot be digested or shipped`);
        this.name = 'EmptyMigrationSetError';
        this.directory = directory;
        Object.setPrototypeOf(this, EmptyMigrationSetError.prototype);
    }
}

/**
 * Type guard for {@link EmptyMigrationSetError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is an empty-migration-set refusal.
 */
export function isEmptyMigrationSetError(value: unknown): value is EmptyMigrationSetError {
    return value instanceof EmptyMigrationSetError;
}
