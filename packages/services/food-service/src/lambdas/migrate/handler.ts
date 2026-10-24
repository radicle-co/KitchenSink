/**
 * In-VPC schema migration runner for `kitchensink_food` (T-191 / FU-MIGRATE). Mirrors the identity
 * `migrate.ts`: the RDS instance is PRIVATE_ISOLATED, so the deploy pipeline (outside the VPC) invokes
 * this VPC-attached Lambda to apply the ordered SQL. Each migration runs once, tracked in
 * `schema_migrations`, so re-invoking is a no-op; a thrown error surfaces as a Lambda FunctionError and
 * fails the deploy's migration step (so a partial/drifted schema never passes silently).
 *
 * AUTH — `food_migrator` authenticates passwordlessly via RDS IAM (feature 003): no secret to read. The
 * connection target comes from env (`FOOD_DB_ENDPOINT`/`FOOD_DB_PORT`/`FOOD_DB_NAME`) and the IAM token is
 * minted per connection by `rdsPoolConfig` (`@kitchensink/rds-iam-auth`). The lambda role holds `rds-db:connect`
 * on the `food_migrator` db-user.
 *
 * @implements ARCH-001
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';

import { applyMigrations, assertBundleMatches, DATABASE_ROLES, parseMigrateEvent } from '@kitchensink/db-schema-guard';
import { rdsPoolConfig } from '@kitchensink/rds-iam-auth';
import type { MigrateResult } from '@kitchensink/db-schema-guard';

import { FOOD_TABLE_POLICY } from '../../db/schema/catalog.js';
import * as schema from '../../db/schema/index.js';
import { readFoodDbTarget } from '../foodDbTarget.js';
import { FoodDatabaseCreateError } from './migrate.errors.js';

const { Pool } = pg;

/**
 * Food's three database roles (`docs/plans/2026-09-11-database-role-split.md`): this runner connects as the
 * MIGRATOR and does every DDL statement as the OWNER, so nothing it creates is owned by the service's login.
 */
const FOOD_ROLES = DATABASE_ROLES.food;

export { discoverMigrations } from '@kitchensink/db-schema-guard';
export type { DiscoveredMigration, MigrateResult } from '@kitchensink/db-schema-guard';

/** Options for {@link runMigrations} — the injectable core (a pool + a migrations directory). */
export interface RunMigrationsOptions {
    /** A connected `pg` pool to the target database. */
    readonly pool: pg.Pool;
    /** The directory holding the ordered `.sql` migrations. */
    readonly migrationsDir: string;
    /**
     * The manifest digest the caller expects this runner to hold.
     *
     * ⛔ REQUIRED. ADR-0035 rejects the optional form by name — "an optional expectation is one a caller
     * forgets, and a forgotten one is indistinguishable from the behaviour it replaces" — and while it was
     * optional here, the property that decision rests on was enforced by one argument check in one shell
     * script rather than by the runner.
     */
    readonly expectManifestSha: string;
    /** The database the pool is connected to — the engine closes it to PUBLIC and admits the two logins. */
    readonly database: string;
}

/**
 * The bundled migrations directory at runtime. esbuild copies `src/db/migrations/*.sql` into
 * `dist-lambda/migrations/`; the handler bundles to `dist-lambda/lambdas/migrate/handler.js`, so the
 * SQL sits two directories up. See `esbuild.mjs`.
 */
const bundledMigrationsDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * The tables every successful migration run must produce — derived from the Drizzle schema (every
 * exported `pgTable`), never hardcoded, so the post-migration validation tracks the schema as it evolves.
 *
 * @returns The expected table names.
 */
function expectedTables(): string[] {
    return (Object.values(schema) as unknown[])
        .filter((value): value is PgTable => is(value, PgTable))
        .map((table) => getTableName(table));
}

/**
 * Apply the food migrations idempotently against a pool, then validate the result.
 *
 * ⛔ The engine is `@kitchensink/db-schema-guard`'s, not a copy. This loop — the advisory lock, the ledger,
 * the rollback, the post-run validation — used to exist three times over, once per service, and the three
 * copies had already drifted in their accounts of why. What is genuinely this service's is bound here:
 * which SQL, and which tables the drizzle schema says must exist afterwards.
 *
 * @param options - The connected pool, the migrations directory, and the caller's manifest expectation.
 * @returns The applied/skipped lists, the validation counts, and the manifest that ran.
 * @throws {Error} when the expectation names a different migration set, the lock cannot be acquired, a
 *   migration's SQL fails, a discovered migration is not recorded, or an expected table is missing.
 * @sideEffect Connects to PostgreSQL, takes a session advisory lock, and executes DDL.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrateResult> {
    return applyMigrations({
        pool: options.pool,
        migrationsDir: options.migrationsDir,
        label: 'food',
        expectedTables: expectedTables(),
        expectManifestSha: options.expectManifestSha,
        database: options.database,
        roles: FOOD_ROLES,
        // The registry's catalog, ledger and dictionary sets (curated catalog plan KTD-13).
        tablePolicy: FOOD_TABLE_POLICY,
    });
}

/** The single shared base logical database (ADR-0006) — the migration runner never CREATEs this one. */
export const BASE_FOOD_DATABASE_NAME = 'kitchensink_food';

/**
 * Valid food logical-database names: the base name, or a per-PR name `kitchensink_food_{suffix}` where
 * the suffix is lowercase alphanumerics/underscores (mirrors `foodDatabaseNameForStage` in the
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
 * Ensure a per-PR food logical database exists, creating it EMPTY from `template0` if absent (ADR-0006, curated
 * catalog plan U7). The base database (`kitchensink_food`) is provisioned by the platform DataStack bootstrap, so this
 * is a no-op for it. For a per-PR name it validates the identifier, checks `pg_database`, and issues
 * `CREATE DATABASE … TEMPLATE template0` if missing. Idempotent and re-invoke-safe: an already-present database
 * returns `'exists'` and is left untouched, and a concurrent creator that wins the race (SQLSTATE 42P04) is also
 * treated as `'exists'`.
 *
 * **Why empty, and why `template0`.** The seed step that follows the migration fills the catalog (KTD-5), so the new
 * database needs nothing from the base. `template0` refuses connections, so no session can hold it and block the
 * create, and it always exists. The first migration creates `pg_trgm` as the owner, which PostgreSQL allows for a
 * trusted extension.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'exists'` if already present, `'created'` if created.
 * @throws {Error} when the database name is not a valid food logical-database name.
 * @throws {FoodDatabaseCreateError} when the migrator may not create the database (SQLSTATE 42501).
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

    // CREATE DATABASE cannot run inside a transaction and cannot be parameterized. The name is validated against
    // FOOD_DATABASE_NAME_PATTERN (no quotes or backslashes possible), so quoting it is injection-safe.
    try {
        // `OWNER` the food owner role, never the migrator that runs this: the migrator may SET ROLE to it, and a
        // database owned by a login is the shape the role split removed.
        await maintenancePool.query(
            `CREATE DATABASE ${pg.escapeIdentifier(databaseName)} TEMPLATE template0 OWNER ${pg.escapeIdentifier(FOOD_ROLES.owner)}`,
        );
    } catch (err) {
        // The pg_database check above is a TOCTOU window: a concurrent invocation can create the
        // database between our SELECT and this CREATE, making CREATE DATABASE throw `duplicate_database`
        // (SQLSTATE 42P04). The database now exists — the desired end state — so treat that one code as
        // success rather than failing the whole migration run.
        if (sqlStateOf(err) === DUPLICATE_DATABASE_SQLSTATE) {
            return 'exists';
        }

        if (sqlStateOf(err) === INSUFFICIENT_PRIVILEGE_SQLSTATE) {
            throw new FoodDatabaseCreateError(databaseName, err);
        }

        throw err;
    }

    return 'created';
}

/** Postgres SQLSTATE for `duplicate_database`, raised when `CREATE DATABASE` names an existing DB. */
const DUPLICATE_DATABASE_SQLSTATE = '42P04';

/** Postgres SQLSTATE for `insufficient_privilege`: the migrator lacks CREATEDB. */
const INSUFFICIENT_PRIVILEGE_SQLSTATE = '42501';

/**
 * The SQLSTATE `pg` surfaces on an error's `code` property, when there is one.
 *
 * @param err - The caught value.
 * @returns The SQLSTATE, or `undefined` for anything that is not a Postgres error.
 */
function sqlStateOf(err: unknown): string | undefined {
    if (typeof err !== 'object' || err === null || !('code' in err)) {
        return undefined;
    }

    const code = (err as { code?: unknown }).code;

    return typeof code === 'string' ? code : undefined;
}

/**
 * Lambda entrypoint. Builds the pool from the DB env (authenticating as `food_migrator` via an RDS IAM token — no
 * secret) and runs + validates the migrations as `food_owner`, creating the per-PR database first if it is absent
 * (ADR-0006).
 *
 * @param event - `{ expectManifestSha }`.
 * @returns The migrate result.
 * @sideEffect Connects to PostgreSQL (RDS IAM auth) and executes DDL.
 */
export const handler = async (event: unknown = {}): Promise<MigrateResult> => {
    const parsed = parseMigrateEvent(event, 'Food');

    const { host, port, database: databaseName } = readFoodDbTarget(process.env);

    // Validate up front (defense in depth — ensureDatabaseExists also validates): the name must match the food
    // logical-database contract before we connect to or create it.
    if (!isValidFoodDatabaseName(databaseName)) {
        throw new Error(`Refusing to migrate: invalid FOOD_DB_NAME "${databaseName}".`);
    }

    const withMaintenancePool = async <T>(run: (pool: pg.Pool) => Promise<T>): Promise<T> => {
        const maintenancePool = new Pool({
            ...rdsPoolConfig({ host, port, database: 'postgres', username: FOOD_ROLES.migrator }),
            max: 1,
        });

        try {
            return await run(maintenancePool);
        } finally {
            await maintenancePool.end();
        }
    };

    // ⛔ BEFORE ANY SIDE EFFECT. A migrate that will CREATE a per-PR logical database (ADR-0006) must not create
    // one and only then discover it is the wrong release's runner: that leaves an empty, unmigrated database
    // behind for the reaper to find. `applyMigrations` makes the same assertion, and this is the only way its
    // "refuse before touching anything" claim can be true for a handler that does work in front of it.
    assertBundleMatches({
        label: 'food',
        migrationsDir: bundledMigrationsDir(),
        expectManifestSha: parsed.expectManifestSha,
    });

    // Per-PR isolation (ADR-0006): a per-PR stage targets `kitchensink_food_pr_{N}`, which the platform
    // bootstrap does NOT create. Create it empty (via the maintenance DB) if absent BEFORE migrating into it; the
    // seed step that follows fills its catalog (U7). The base `kitchensink_food` short-circuits (skipped-base).
    if (databaseName !== BASE_FOOD_DATABASE_NAME) {
        await withMaintenancePool((pool) => ensureDatabaseExists({ maintenancePool: pool, databaseName }));
    }

    const pool = new Pool({
        ...rdsPoolConfig({ host, port, database: databaseName, username: FOOD_ROLES.migrator }),
        max: 1,
    });

    try {
        return await runMigrations({
            pool,
            migrationsDir: bundledMigrationsDir(),
            expectManifestSha: parsed.expectManifestSha,
            database: databaseName,
        });
    } finally {
        await pool.end();
    }
};
