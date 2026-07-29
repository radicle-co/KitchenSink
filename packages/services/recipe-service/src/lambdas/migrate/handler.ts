/**
 * In-VPC schema migration runner for `kitchensink_recipes` (feature 001, ADR-0006). Mirrors the food
 * migrate handler: the RDS instance is PRIVATE_ISOLATED, so the deploy pipeline (outside the VPC) invokes
 * this VPC-attached Lambda to apply the ordered SQL. Each migration runs once, tracked in
 * `schema_migrations`, so re-invoking is a no-op; a thrown error surfaces as a Lambda FunctionError and
 * fails the deploy's migration step (so a partial/drifted schema never passes silently).
 *
 * AUTH — `recipe_app` authenticates passwordlessly via RDS IAM: no secret to read. The connection target
 * comes from env (`DB_HOST`/`DB_PORT`/`DB_NAME`) and the IAM token is minted per connection by
 * {@link recipePoolConfig}. The lambda role holds `rds-db:connect` on the `recipe_app` db-user (granted in
 * the recipe service stack).
 *
 * @sideEffect Connects to PostgreSQL (RDS IAM auth) and executes DDL.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';

import { BASE_RECIPE_DATABASE_NAME } from '@kitchensink/recipe-core/database-name';

import { RECIPE_DB_USERNAME, recipePoolConfig } from '../../database/pool-config.js';
import * as schema from '../../database/schema/index.js';

const { Pool } = pg;

/** A discovered migration: its tracking `name` (filename without `.sql`) and the `.sql` filename. */
export interface DiscoveredMigration {
    readonly name: string;
    readonly file: string;
}

/** The structured result of a migration run (returned to the deploy-time `lambda invoke`). */
export interface MigrateResult {
    readonly applied: string[];
    readonly skipped: string[];
    readonly validated: { readonly migrations: number; readonly tables: number };
}

/** Options for {@link runMigrations} — a connected pool + the ordered migrations directory. */
export interface RunMigrationsOptions {
    readonly pool: pg.Pool;
    readonly migrationsDir: string;
}

/**
 * The bundled migrations directory at runtime. esbuild copies `src/database/migrations/*.sql` into
 * `dist-lambda/migrations/`; the handler bundles to `dist-lambda/lambdas/migrate/handler.js`, so the SQL
 * sits two directories up. See `esbuild.mjs`.
 */
const bundledMigrationsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Discover the ordered `.sql` migrations in a directory — sorted by filename so the numeric prefix drives
 * a deterministic order. No hardcoded list.
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
 * exported `pgTable`), never hardcoded.
 *
 * @returns The expected table names.
 */
function expectedTables(): string[] {
    return (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => getTableName(table));
}

/**
 * Apply the ordered migrations idempotently against a pool, then validate the result. The testable core
 * of {@link handler}.
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

        const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
        const recordedNames = new Set(recorded.rows.map((row) => row.name));
        const missingMigrations = migrations.map((m) => m.name).filter((name) => !recordedNames.has(name));

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

/**
 * Valid recipe logical-database names: the base name, or a per-PR name `kitchensink_recipes_{suffix}`
 * where the suffix is lowercase alphanumerics/underscores. This is the ACCEPTING side of
 * `recipeDatabaseNameForStage` (`@kitchensink/recipe-core`), which is the only producer of these names —
 * the two are one contract, pinned from the producing side by that function's "always produces a name the
 * migration runner will accept" test. Because the name is validated against this pattern, it is safe to
 * quote directly into a `CREATE DATABASE "<name>"` statement (which cannot be parameterized).
 */
const RECIPE_DATABASE_NAME_PATTERN = /^kitchensink_recipes(_[a-z0-9_]+)?$/;

/**
 * Guard that a database name is a well-formed recipe logical-database name.
 *
 * @param name - The candidate database name.
 * @returns `true` when the name matches the recipe database naming contract.
 */
export function isValidRecipeDatabaseName(name: string): boolean {
    return RECIPE_DATABASE_NAME_PATTERN.test(name);
}

/** Options for {@link ensureDatabaseExists} — a pool connected to the MAINTENANCE database. */
export interface EnsureDatabaseOptions {
    readonly maintenancePool: pg.Pool;
    readonly databaseName: string;
}

/** The outcome of an {@link ensureDatabaseExists} call. */
export type EnsureDatabaseResult = 'skipped-base' | 'exists' | 'created';

const DUPLICATE_DATABASE_SQLSTATE = '42P04';

function isDuplicateDatabaseError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === DUPLICATE_DATABASE_SQLSTATE
    );
}

/**
 * Ensure a per-PR recipe logical database exists, creating it if absent (ADR-0006). The base database is
 * provisioned by the platform DataStack bootstrap, so this is a no-op for it. Idempotent + race-safe.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'exists'` if already present, `'created'` if created.
 * @throws {Error} when the database name is not a valid recipe logical-database name.
 * @sideEffect Connects to the maintenance database and may execute `CREATE DATABASE`.
 */
export async function ensureDatabaseExists(options: EnsureDatabaseOptions): Promise<EnsureDatabaseResult> {
    const { maintenancePool, databaseName } = options;

    if (databaseName === BASE_RECIPE_DATABASE_NAME) {
        return 'skipped-base';
    }

    if (!isValidRecipeDatabaseName(databaseName)) {
        throw new Error(`Refusing to create database with invalid name: ${databaseName}`);
    }

    const existing = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existing.rowCount ?? 0) > 0) {
        return 'exists';
    }

    try {
        await maintenancePool.query(`CREATE DATABASE "${databaseName}"`);
    } catch (err) {
        if (isDuplicateDatabaseError(err)) {
            return 'exists';
        }

        throw err;
    }

    return 'created';
}

/** The outcome of a {@link dropDatabase} call. */
export type DropDatabaseResult = 'skipped-base' | 'dropped' | 'absent';

/**
 * Drop a per-PR recipe logical database (ADR-0006 PR-close cleanup). The base `kitchensink_recipes` is
 * NEVER dropped. Uses `DROP DATABASE IF EXISTS … WITH (FORCE)` to terminate lingering connections.
 * Idempotent.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'dropped'` if dropped, else `'absent'`.
 * @throws {Error} when the database name is not a valid recipe logical-database name.
 * @sideEffect Connects to the maintenance database and may execute `DROP DATABASE`.
 */
export async function dropDatabase(options: EnsureDatabaseOptions): Promise<DropDatabaseResult> {
    const { maintenancePool, databaseName } = options;

    if (databaseName === BASE_RECIPE_DATABASE_NAME) {
        return 'skipped-base';
    }

    if (!isValidRecipeDatabaseName(databaseName)) {
        throw new Error(`Refusing to drop database with invalid name: ${databaseName}`);
    }

    const existing = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);

    if ((existing.rowCount ?? 0) === 0) {
        return 'absent';
    }

    await maintenancePool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);

    return 'dropped';
}

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

/** The event the migration runner accepts. Absent/`migrate` → apply; `drop` → per-PR teardown. */
export interface MigrateEvent {
    readonly action?: 'migrate' | 'drop';
}

/**
 * Lambda entrypoint. With no action (or `migrate`) it builds the pool from the DB env (authenticating as
 * `recipe_app` via an RDS IAM token) and runs + validates the migrations, creating the per-PR database
 * first if absent (ADR-0006). With `action: 'drop'` it drops the per-PR database (never the base).
 *
 * @param event - Optional `{ action }` (defaults to `migrate`).
 * @returns The migrate result, or the drop result when `action` is `drop`.
 * @sideEffect Connects to PostgreSQL (RDS IAM auth) and executes DDL.
 */
export const handler = async (event: MigrateEvent = {}): Promise<MigrateResult | { dropped: DropDatabaseResult }> => {
    const host = requireEnv('DB_HOST');
    const port = Number(requireEnv('DB_PORT'));
    const databaseName = requireEnv('DB_NAME');

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid DB_PORT "${process.env['DB_PORT']}" — expected a TCP port (1-65535).`);
    }

    if (!isValidRecipeDatabaseName(databaseName)) {
        throw new Error(`Refusing to migrate: invalid DB_NAME "${databaseName}".`);
    }

    const withMaintenancePool = async <T>(run: (pool: pg.Pool) => Promise<T>): Promise<T> => {
        const maintenancePool = new Pool({
            ...recipePoolConfig({ host, port, database: 'postgres', username: RECIPE_DB_USERNAME }),
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

    if (databaseName !== BASE_RECIPE_DATABASE_NAME) {
        await withMaintenancePool((pool) => ensureDatabaseExists({ maintenancePool: pool, databaseName }));
    }

    const pool = new Pool({
        ...recipePoolConfig({ host, port, database: databaseName, username: RECIPE_DB_USERNAME }),
        max: 1,
    });

    try {
        return await runMigrations({ pool, migrationsDir: bundledMigrationsDir() });
    } finally {
        await pool.end();
    }
};
