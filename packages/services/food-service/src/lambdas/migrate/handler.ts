/**
 * In-VPC schema migration runner for `kitchensink_food` (T-191 / FU-MIGRATE). Mirrors the identity
 * `migrate.ts`: the RDS instance is PRIVATE_ISOLATED, so the deploy pipeline (outside the VPC) invokes
 * this VPC-attached Lambda to apply the ordered SQL. Each migration runs once, tracked in
 * `schema_migrations`, so re-invoking is a no-op; a thrown error surfaces as a Lambda FunctionError and
 * fails the deploy's migration step (so a partial/drifted schema never passes silently).
 *
 * SECRET SHAPE — unlike identity's `food_db` master secret, the `food_app` least-privilege secret holds
 * ONLY `{ username, password }`. This handler therefore reads the credentials from the secret
 * (`FOOD_DB_SECRET_ARN`) and the connection target from env (`FOOD_DB_ENDPOINT`/`FOOD_DB_PORT`/
 * `FOOD_DB_NAME`) — see DataStack T-001b.
 *
 * @implements ARCH-001
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';

import * as schema from '../../db/schema/index.js';

const { Pool } = pg;

/** A discovered migration: its tracking `name` (filename without `.sql`) and the `.sql` filename. */
export interface DiscoveredMigration {
    /** The `schema_migrations` tracking key (filename without the `.sql` suffix). */
    readonly name: string;
    /** The `.sql` filename within the migrations directory. */
    readonly file: string;
}

/** The structured result of a migration run (returned to the deploy-time `lambda invoke`). */
export interface MigrateResult {
    /** Migrations applied this run, in order. */
    readonly applied: string[];
    /** Migrations skipped because already recorded, in order. */
    readonly skipped: string[];
    /** Post-run validation counts. */
    readonly validated: { readonly migrations: number; readonly tables: number };
}

/** Options for {@link runMigrations} — the injectable core (a pool + a migrations directory). */
export interface RunMigrationsOptions {
    /** A connected `pg` pool to the target database. */
    readonly pool: pg.Pool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
}

/**
 * The bundled migrations directory at runtime. esbuild copies `src/db/migrations/*.sql` into
 * `dist-lambda/migrations/`; the handler bundles to `dist-lambda/lambdas/migrate/handler.js`, so the
 * SQL sits two directories up. See `esbuild.mjs`.
 */
const bundledMigrationsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Discover the ordered `.sql` migrations in a directory — sorted by filename so the numeric prefix
 * (`0000`, `0001`, …) drives a deterministic order. NO hardcoded list: drop a `.sql` file in and it is
 * picked up automatically.
 *
 * @param migrationsDir - The directory to scan.
 * @returns The discovered migrations in apply order.
 * @sideEffect Reads the migrations directory.
 */
export function discoverMigrations(migrationsDir: string): DiscoveredMigration[] {
    return readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => ({ name: file.replace(/\.sql$/, ''), file }));
}

/**
 * The tables every successful migration run must produce — derived from the Drizzle schema (every
 * exported `pgTable`), never hardcoded, so the post-migration validation tracks the schema as it
 * evolves.
 *
 * @returns The expected table names.
 */
function expectedTables(): string[] {
    return (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => getTableName(table));
}

/**
 * Apply the ordered migrations idempotently against a pool, then validate the result. The testable
 * core of {@link handler} (the handler only builds the pool from the secret + env).
 *
 * @param options - The connected pool + the migrations directory.
 * @returns The applied/skipped lists + validation counts.
 * @throws {Error} when a migration's SQL fails, a discovered migration is not recorded, or an expected
 *   table is missing after the run.
 * @sideEffect Connects to PostgreSQL and executes DDL.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrateResult> {
    const { pool, migrationsDir } = options;
    const migrations = discoverMigrations(migrationsDir);
    const applied: string[] = [];
    const skipped: string[] = [];
    const client = await pool.connect();

    try {
        await client.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );

        for (const migration of migrations) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(migration.name);
                continue;
            }

            const sql = readFileSync(join(migrationsDir, migration.file), 'utf8');
            await client.query('BEGIN');

            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
                await client.query('COMMIT');
                applied.push(migration.name);
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${migration.name} failed`, { cause: err });
            }
        }

        // Post-migration validation. Throwing surfaces as a Lambda FunctionError → the deploy's migration
        // step fails, so a partially-applied or drifted schema never passes silently. Both sides are
        // derived (migration files + drizzle schema), so nothing here is hardcoded.
        const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
        const recordedNames = new Set(recorded.rows.map((row) => row.name));
        const missingMigrations = migrations
            .map((migration) => migration.name)
            .filter((name) => !recordedNames.has(name));

        if (missingMigrations.length > 0) {
            throw new Error(
                `Post-migration validation failed — migrations not recorded: ${missingMigrations.join(', ')}`,
            );
        }

        const tables = expectedTables();
        const present = await client.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
            [tables],
        );
        const presentTables = new Set(present.rows.map((row) => row.table_name));
        const missingTables = tables.filter((table) => !presentTables.has(table));

        if (missingTables.length > 0) {
            throw new Error(`Post-migration validation failed — tables missing: ${missingTables.join(', ')}`);
        }

        return { applied, skipped, validated: { migrations: migrations.length, tables: tables.length } };
    } finally {
        client.release();
    }
}

/** The single shared base logical database (ADR-0006) — the migration runner never CREATEs this one. */
export const BASE_FOOD_DATABASE_NAME = 'kitchensink_food';

/**
 * Valid food logical-database names: the base name, or a per-PR name `kitchensink_food_{suffix}` where
 * the suffix is lowercase alphanumerics/underscores (mirrors {@link foodDatabaseNameForStage} in the
 * CDK stack). Because the name is validated against this pattern, it is safe to quote directly into a
 * `CREATE DATABASE "<name>"` statement (which cannot be parameterized) with no injection surface.
 */
const FOOD_DATABASE_NAME_PATTERN = /^kitchensink_food(_[a-z0-9_]+)?$/;

/**
 * Guard that a database name is a well-formed food logical-database name.
 *
 * @param name - The candidate database name.
 * @returns `true` when the name matches the food database naming contract.
 */
export function isValidFoodDatabaseName(name: string): boolean {
    return FOOD_DATABASE_NAME_PATTERN.test(name);
}

/** Options for {@link ensureDatabaseExists} — a pool connected to the MAINTENANCE database. */
export interface EnsureDatabaseOptions {
    /** A `pg` pool connected to the maintenance database (`postgres`), NOT the target DB. */
    readonly maintenancePool: pg.Pool;
    /** The target food logical-database name to ensure exists. */
    readonly databaseName: string;
}

/** The outcome of an {@link ensureDatabaseExists} call. */
export type EnsureDatabaseResult = 'skipped-base' | 'exists' | 'created';

/**
 * Ensure a per-PR food logical database exists, creating it if absent (ADR-0006). The base database
 * (`kitchensink_food`) is provisioned by the platform DataStack bootstrap SQL, so this is a no-op for
 * it. For a per-PR name it validates the identifier, checks `pg_database`, and `CREATE DATABASE`s it if
 * missing. Idempotent and re-invoke-safe: an already-present database returns `'exists'`, and a
 * concurrent creator that wins the `CREATE DATABASE` race (SQLSTATE 42P04) is also treated as `'exists'`.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'exists'` if already present, `'created'` if created.
 * @throws {Error} when the database name is not a valid food logical-database name.
 * @sideEffect Connects to the maintenance database and may execute `CREATE DATABASE`.
 */
export async function ensureDatabaseExists(options: EnsureDatabaseOptions): Promise<EnsureDatabaseResult> {
    const { maintenancePool, databaseName } = options;

    if (databaseName === BASE_FOOD_DATABASE_NAME) {
        return 'skipped-base';
    }

    if (!isValidFoodDatabaseName(databaseName)) {
        throw new Error(`Refusing to create database with invalid name: ${databaseName}`);
    }

    const existing = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existing.rowCount ?? 0) > 0) {
        return 'exists';
    }

    // CREATE DATABASE cannot run inside a transaction and cannot be parameterized. The name is
    // validated above against FOOD_DATABASE_NAME_PATTERN (no quotes/backslashes possible), so quoting
    // it as an identifier is safe.
    try {
        await maintenancePool.query(`CREATE DATABASE "${databaseName}"`);
    } catch (err) {
        // The pg_database check above is a TOCTOU window: a concurrent invocation can create the
        // database between our SELECT and this CREATE, making CREATE DATABASE throw `duplicate_database`
        // (SQLSTATE 42P04). The database now exists — the desired end state — so treat that one code as
        // success rather than failing the whole migration run.
        if (isDuplicateDatabaseError(err)) {
            return 'exists';
        }

        throw err;
    }

    return 'created';
}

/** Postgres SQLSTATE for `duplicate_database`, raised when `CREATE DATABASE` names an existing DB. */
const DUPLICATE_DATABASE_SQLSTATE = '42P04';

/**
 * Type guard for the Postgres `duplicate_database` error (SQLSTATE {@link DUPLICATE_DATABASE_SQLSTATE}) —
 * raised when `CREATE DATABASE` loses a race to a concurrent creator. `pg` surfaces the SQLSTATE on the
 * error's `code` property.
 */
function isDuplicateDatabaseError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === DUPLICATE_DATABASE_SQLSTATE
    );
}

/** The outcome of a {@link dropDatabase} call. */
export type DropDatabaseResult = 'skipped-base' | 'dropped' | 'absent';

/**
 * Drop a per-PR food logical database (ADR-0006 PR-close cleanup). The base `kitchensink_food` is
 * NEVER dropped (returns `'skipped-base'`). Uses `DROP DATABASE IF EXISTS … WITH (FORCE)` so lingering
 * connections from a still-draining preview service are terminated (PostgreSQL 13+/RDS PG16).
 * Idempotent: dropping an already-absent database returns `'absent'`.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'dropped'` if it existed and was dropped, else `'absent'`.
 * @throws {Error} when the database name is not a valid food logical-database name.
 * @sideEffect Connects to the maintenance database and may execute `DROP DATABASE`.
 */
export async function dropDatabase(options: EnsureDatabaseOptions): Promise<DropDatabaseResult> {
    const { maintenancePool, databaseName } = options;

    if (databaseName === BASE_FOOD_DATABASE_NAME) {
        return 'skipped-base';
    }

    if (!isValidFoodDatabaseName(databaseName)) {
        throw new Error(`Refusing to drop database with invalid name: ${databaseName}`);
    }

    const existing = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existing.rowCount ?? 0) === 0) {
        return 'absent';
    }

    // Identifier validated above (no quotes/backslashes possible), so quoting is injection-safe.
    await maintenancePool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);

    return 'dropped';
}

/** The `food_app` secret payload — username/password only (host/port/dbname come from env). */
interface FoodDbCredentials {
    /** The database role. */
    readonly username: string;
    /** The role password. */
    readonly password: string;
}

/**
 * Read the `food_app` username/password from Secrets Manager.
 *
 * @param secretArn - The `FOOD_DB_SECRET_ARN`.
 * @returns The credentials.
 * @throws {Error} when the secret has no payload or is missing a credential field.
 * @sideEffect Calls Secrets Manager `GetSecretValue`.
 */
async function readFoodDbCredentials(secretArn: string): Promise<FoodDbCredentials> {
    const client = new SecretsManagerClient({});
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

    if (!response.SecretString) {
        throw new Error(`Secret ${secretArn} has no SecretString payload`);
    }

    const parsed = JSON.parse(response.SecretString) as Partial<FoodDbCredentials>;

    if (!parsed.username || !parsed.password) {
        throw new Error(`Secret ${secretArn} missing username/password`);
    }

    return { username: parsed.username, password: parsed.password };
}

/**
 * Read a required environment variable (bracket-notation per project convention).
 *
 * @param name - The variable name.
 * @returns The value.
 * @throws {Error} when unset/empty.
 */
function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

/** The event the migration runner accepts. Absent/`migrate` → apply migrations; `drop` → PR-close teardown. */
export interface MigrateEvent {
    /** `migrate` (default) applies migrations; `drop` drops the per-PR database (ADR-0006 cleanup). */
    readonly action?: 'migrate' | 'drop';
}

/**
 * Lambda entrypoint. With no action (or `migrate`) it builds the pool from the `food_app` secret + DB
 * env and runs + validates the migrations, creating the per-PR database first if it is absent
 * (ADR-0006). With `action: 'drop'` it drops the per-PR database (never the base) for PR-close cleanup.
 *
 * @param event - Optional `{ action }` (defaults to `migrate`).
 * @returns The migrate result, or the drop result when `action` is `drop`.
 * @sideEffect Reads Secrets Manager, connects to PostgreSQL, and executes DDL.
 */
export const handler = async (event: MigrateEvent = {}): Promise<MigrateResult | { dropped: DropDatabaseResult }> => {
    const credentials = await readFoodDbCredentials(requireEnv('FOOD_DB_SECRET_ARN'));
    const host = requireEnv('FOOD_DB_ENDPOINT');
    const port = Number(requireEnv('FOOD_DB_PORT'));
    const databaseName = requireEnv('FOOD_DB_NAME');
    const ssl = process.env['STAGE'] === 'local' ? false : { rejectUnauthorized: false };

    const withMaintenancePool = async <T>(run: (pool: pg.Pool) => Promise<T>): Promise<T> => {
        const maintenancePool = new Pool({
            user: credentials.username,
            password: credentials.password,
            host,
            port,
            database: 'postgres',
            ssl,
            max: 1,
        });

        try {
            return await run(maintenancePool);
        } finally {
            await maintenancePool.end();
        }
    };

    if (event.action === 'drop') {
        const dropped = await withMaintenancePool((pool) => dropDatabase({ maintenancePool: pool, databaseName }));

        return { dropped };
    }

    // Per-PR isolation (ADR-0006): a per-PR stage targets `kitchensink_food_pr_{N}`, which the platform
    // bootstrap does NOT create. CREATE it (via the maintenance DB) if absent BEFORE migrating into it.
    // The base `kitchensink_food` short-circuits (skipped-base), so the prod/sandbox path is unchanged.
    if (databaseName !== BASE_FOOD_DATABASE_NAME) {
        await withMaintenancePool((pool) => ensureDatabaseExists({ maintenancePool: pool, databaseName }));
    }

    const pool = new Pool({
        user: credentials.username,
        password: credentials.password,
        host,
        port,
        database: databaseName,
        ssl,
        max: 1,
    });

    try {
        return await runMigrations({ pool, migrationsDir: bundledMigrationsDir() });
    } finally {
        await pool.end();
    }
};
