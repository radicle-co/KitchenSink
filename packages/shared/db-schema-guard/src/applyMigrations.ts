/**
 * The migration APPLY ENGINE — one implementation for every schema in the monorepo.
 *
 * ## Why this is here and not three times over
 *
 * `identity`, `food-service` and `recipe-service` each carried a private copy of this loop: the same
 * advisory-lock key, the same `lock_timeout` dance, the same ledger, the same rollback, the same post-run
 * validation. Three copies of one piece of knowledge, already drifting in their accounts of WHY. The
 * manifest assertion this release adds would have been a fourth thing written three times.
 *
 * What legitimately differs per service is injected: the migrations directory, the tables the drizzle
 * schema says must exist afterwards, and the label that makes a failure readable.
 *
 * ## What the ledger cannot do, and what closes it
 *
 * `schema_migrations` is keyed by FILENAME with no checksum, and the runner skips on a name match. So the
 * ledger cannot see an edited migration, and — the failure ADR-0022 records — it cannot tell "everything is
 * applied" from "this runner has never heard of the new migrations", which is what a PREVIOUS release's
 * bundle reports. {@link ApplyMigrationsOptions.expectManifestSha} is the caller stating which set it wants;
 * a runner holding a different one fails loudly instead of returning an empty `applied[]`.
 */
import { readdirSync } from 'node:fs';

import { assertManifestMatches } from './assertions.js';
import type { MigrationManifest } from './manifestFile.js';
import { readMigrationManifest } from './manifestFile.js';
import type { MigrationClient, MigrationPool } from './port.js';

/** A discovered migration: its tracking `name` (filename without `.sql`) and the `.sql` filename. */
export interface DiscoveredMigration {
    /** The `schema_migrations` tracking key (filename without the `.sql` suffix). */
    readonly name: string;
    /** The `.sql` filename within the migrations directory. */
    readonly file: string;
}

/** The structured result of a migration run, returned to whoever invoked the runner. */
export interface MigrateResult {
    /** Migrations applied this run, in order. */
    readonly applied: string[];
    /** Migrations skipped because already recorded, in order. */
    readonly skipped: string[];
    /** Post-run validation counts. */
    readonly validated: { readonly migrations: number; readonly tables: number };
    /**
     * The manifest digest of the set this run actually held.
     *
     * Returned unconditionally, including when no expectation was supplied, so the deploy log records WHICH
     * migration set produced the result rather than only that a result was produced.
     */
    readonly manifestSha: string;
}

/** Options for {@link applyMigrations}. */
export interface ApplyMigrationsOptions {
    /** A pool connected to the target database. */
    readonly pool: MigrationPool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
    /** Which schema this is — used only to make failures readable. */
    readonly label: string;
    /** The tables the schema must expose once every migration has been applied. */
    readonly expectedTables: readonly string[];
    /** The manifest digest the caller expects this runner to hold, when it stated one. */
    readonly expectManifestSha?: string | undefined;
}

/**
 * The session advisory-lock key every migration run serializes on.
 *
 * ⛔ WHY THIS EXISTS. Idempotency comes from `schema_migrations`, and that ledger is CHECKED-then-APPLIED,
 * which is not atomic: two runners starting together both read "unapplied" and both execute the file. The
 * loser then fails on a `CREATE TABLE`/`CREATE EXTENSION` the winner just committed, and because the
 * runner's throw surfaces as a Lambda `FunctionError` that failure is a RED DEPLOY, not a retry. It
 * reproduces on the first attempt — see recipe-service's
 * `__tests__/integration/database/migrationRunner.integration.test.ts`.
 *
 * ⚠️ It changes deploy behaviour: a second runner WAITS instead of racing. That is the intended trade — a
 * bounded wait ending in "everything skipped" beats a fast failure against a schema that was already right.
 *
 * Advisory locks are scoped to the DATABASE, so one constant serves every schema: identity's runner and
 * food's hold the same key over different databases and never meet. The value is an arbitrary fixed 64-bit
 * constant; the digits carry no meaning beyond being stable.
 */
const MIGRATION_ADVISORY_LOCK_KEY = '7412200228220022';

/**
 * How long a runner waits for the lock before failing with a Postgres lock error.
 *
 * Sized under the runners' own Lambda timeout on purpose: without it, a runner blocked behind a stuck peer
 * is killed by Lambda with no diagnostic at all. With it, the deploy fails saying it could not take the
 * migration lock, which names the actual problem.
 */
const MIGRATION_LOCK_TIMEOUT_MS = 240_000;

/**
 * Discover the ordered `.sql` migrations in a directory — sorted by filename, so the numeric prefix drives
 * a deterministic order. NO hardcoded list: drop a `.sql` file in and it is picked up automatically.
 *
 * @param migrationsDir - The directory to scan.
 * @returns The discovered migrations in apply order.
 * @sideEffect Reads the migrations directory.
 */
export function discoverMigrations(migrationsDir: string): DiscoveredMigration[] {
    return readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => ({ name: file.replace(/\.sql$/u, ''), file }));
}

/**
 * The same list, derived from a manifest already read — so the apply loop does not scan the directory a
 * second time and cannot disagree with the set it just digested.
 *
 * @param manifest - A manifest read from the migrations directory.
 * @returns The discovered migrations in apply order.
 */
function migrationsOf(manifest: MigrationManifest): DiscoveredMigration[] {
    return manifest.migrations.map((file) => ({ name: file.replace(/\.sql$/u, ''), file }));
}

/**
 * Apply the ordered migrations idempotently against a pool, then validate the result.
 *
 * The manifest is checked FIRST, before a connection is taken: a runner holding the wrong set must fail
 * without taking the advisory lock, or it blocks the correct runner behind it for the whole lock timeout
 * and turns a clear "wrong bundle" failure into a slow, confusing one.
 *
 * @param options - The pool, the migrations directory, the label, the expected tables and the expectation.
 * @returns The applied/skipped lists, the validation counts and the manifest that ran.
 * @throws {EmptyMigrationSetError} when the directory holds no `.sql`.
 * @throws {SchemaManifestMismatchError} when the caller's expectation names a different set.
 * @throws {Error} when no expected tables were supplied, the lock cannot be acquired, a migration's SQL
 *   fails, a discovered migration is not recorded, or an expected table is missing after the run.
 * @sideEffect Reads the migrations directory, connects to PostgreSQL, takes a session advisory lock, and
 *   executes DDL.
 */
export async function applyMigrations(options: ApplyMigrationsOptions): Promise<MigrateResult> {
    const { pool, migrationsDir, label, expectedTables, expectManifestSha } = options;

    if (expectedTables.length === 0) {
        throw new Error(
            `[${label}] refusing to migrate with no expected tables — the table check is the only thing ` +
                'between "every migration is recorded" and "the schema they were supposed to produce exists", ' +
                'and an empty list passes vacuously',
        );
    }

    const manifest = readMigrationManifest(migrationsDir);

    if (expectManifestSha !== undefined) {
        assertManifestMatches({
            label,
            expected: expectManifestSha,
            actual: manifest.sha,
            migrations: manifest.migrations,
        });
    }

    const migrations = migrationsOf(manifest);
    const applied: string[] = [];
    const skipped: string[] = [];
    const client = await pool.connect();
    let holdsLock = false;

    try {
        // ⛔ BEFORE the ledger is even created, so two runners cannot both create it and both read it empty.
        // `lock_timeout` is RESET immediately after: it is a session setting and this client goes back to a
        // pool, so leaving it set would silently shorten every later statement's lock wait.
        await client.query(`SET lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`);

        try {
            await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
            holdsLock = true;
        } finally {
            await client.query('RESET lock_timeout');
        }

        await client.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );

        for (const migration of migrations) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(migration.name);
                continue;
            }

            const sql = manifest.bodies.get(migration.file) ?? '';

            await client.query('BEGIN');

            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
                await client.query('COMMIT');
                applied.push(migration.name);
            } catch (err) {
                // ROLLBACK before rethrowing: the migration's own DDL must not survive, and its name must
                // stay UNRECORDED so the next run retries it rather than skipping a half-applied change.
                await client.query('ROLLBACK');

                throw new Error(`Migration ${migration.name} failed`, { cause: err });
            }
        }

        await validate({ client, label, migrations, expectedTables });

        return {
            applied,
            skipped,
            validated: { migrations: migrations.length, tables: expectedTables.length },
            manifestSha: manifest.sha,
        };
    } finally {
        // ⛔ Released EXPLICITLY, not left to the connection dying. A session advisory lock outlives the
        // statement that took it, and `release()` returns the session to the pool still holding it — which
        // would deadlock the very next runner on a pool that outlives one call.
        if (holdsLock) {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
        }

        client.release();
    }
}

/**
 * Post-migration validation. Throwing surfaces as a Lambda `FunctionError`, so nothing rolls out against a
 * partially-applied or drifted schema. Both sides are DERIVED — the migration files it found, and the
 * drizzle schema its caller read — so nothing here is hardcoded.
 *
 * @param input - The connected client, the label, the migrations run, and the tables expected.
 * @throws {Error} when a migration is unrecorded or an expected table is absent.
 * @sideEffect Queries the database.
 */
async function validate(input: {
    readonly client: MigrationClient;
    readonly label: string;
    readonly migrations: readonly DiscoveredMigration[];
    readonly expectedTables: readonly string[];
}): Promise<void> {
    const { client, label, migrations, expectedTables } = input;
    const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const recordedNames = new Set(recorded.rows.map((row) => row.name));
    const unrecorded = migrations.map((migration) => migration.name).filter((name) => !recordedNames.has(name));

    if (unrecorded.length > 0) {
        throw new Error(
            `[${label}] post-migration validation failed — migrations not recorded: ${unrecorded.join(', ')}`,
        );
    }

    const present = await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
        [[...expectedTables]],
    );
    const presentTables = new Set(present.rows.map((row) => row.table_name));
    const missingTables = expectedTables.filter((table) => !presentTables.has(table));

    if (missingTables.length > 0) {
        throw new Error(`[${label}] post-migration validation failed — tables missing: ${missingTables.join(', ')}`);
    }
}
