/**
 * The BOOT guard — a process that reads the schema, checking it is not behind its own release.
 *
 * ## What it is for, given the pipeline already orders the migration
 *
 * The pipeline applies the schema before deploying anything that reads it, so the ordinary release path is
 * covered without this. It exists for the paths that are not a release, which is exactly the set the
 * migration safety net was kept for — "a stage whose schema is behind for a reason no code change explains":
 *
 *  - a database restored from a snapshot taken before a migration, with tasks left running;
 *  - a task that scales out long after such a restore;
 *  - a stack deployed by hand, outside a pipeline, which gets no ordering at all.
 *
 * ## ⛔ Why it ships in `warn`
 *
 * A boot assertion that fails closed can crash-loop an entire service, so the MODE it ships in matters more
 * than the check. It observes for a soak and the flip to `enforce` is one environment variable, once the
 * reports read clean. In `warn` nothing throws — not a behind schema, not an unreadable ledger, not a
 * missing migrations directory — because a guard that takes a service down while it is supposed to be
 * watching is worse than no guard at all.
 *
 * An UNRECOGNISED mode resolves to `warn`, never to `enforce`: a typo in a deploy variable must not
 * silently arm a check that can crash-loop a service.
 */
import { discoverMigrations } from './applyMigrations.js';
import { assertSchemaCurrent } from './assertions.js';

/** How the boot guard behaves when the schema is behind. */
export type SchemaCurrencyMode = 'warn' | 'enforce';

/**
 * Resolve the boot guard's mode from a raw environment value.
 *
 * @param raw - The configured value, if any.
 * @returns `'enforce'` only for an exact (trimmed, case-insensitive) `enforce`; `'warn'` otherwise.
 */
export function schemaCurrencyMode(raw: string | undefined): SchemaCurrencyMode {
    return (raw ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'warn';
}

/** Options for {@link verifySchemaCurrent}. */
export interface VerifySchemaCurrentOptions {
    /** Which process is checking — used only to make the report readable. */
    readonly label: string;
    /** Whether a behind schema refuses the boot or is merely reported. */
    readonly mode: SchemaCurrencyMode;
    /** The directory holding this release's ordered `.sql` migrations, as shipped in the image. */
    readonly migrationsDir: string;
    /** Reads the names recorded in the target database's `schema_migrations` ledger. */
    readonly readApplied: () => Promise<readonly string[]>;
    /** Where a finding goes. Injected so the caller's logger is used and nothing here writes to stdout. */
    readonly report: (message: string) => void;
}

/**
 * Check that the database has applied every migration this release ships.
 *
 * @param options - The label, the mode, the migrations directory, the ledger reader and the reporter.
 * @throws {SchemaBehindError} in `enforce`, when a required migration is unapplied.
 * @throws {Error} in `enforce`, when the migrations are unreadable or the ledger cannot be read.
 * @sideEffect Reads the migrations directory, calls `readApplied` (which reads the database), and may call
 *   `report`.
 */
export async function verifySchemaCurrent(options: VerifySchemaCurrentOptions): Promise<void> {
    const { label, mode, migrationsDir, readApplied, report } = options;

    try {
        await assertSchemaCurrent({
            label,
            expected: discoverMigrations(migrationsDir).map((migration) => migration.name),
            readApplied,
        });
    } catch (err) {
        if (mode === 'enforce') {
            throw err;
        }

        // The mode is named in the line on purpose: a reader of the soak's logs has to be able to tell
        // whether this boot WOULD have been refused, which is the whole question the soak answers.
        report(`[${label}] schema-currency check failed (mode=warn, not refusing): ${String(err)}`);
    }
}
