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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { z } from 'zod';

import { applyMigrations } from '@kitchensink/db-schema-guard';
import type { MigrateResult } from '@kitchensink/db-schema-guard';

import { BASE_RECIPE_DATABASE_NAME } from '@kitchensink/recipe-core/database-name';

import { RECIPE_DB_USERNAME, recipePoolConfig } from '../../database/poolConfig.js';
import * as schema from '../../database/schema/index.js';

const { Pool } = pg;

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
}

/**
 * The bundled migrations directory at runtime. esbuild copies `src/database/migrations/*.sql` into
 * `dist-lambda/migrations/`; the handler bundles to `dist-lambda/lambdas/migrate/handler.js`, so the SQL
 * sits two directories up. See `esbuild.mjs`.
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
 * Apply the recipe migrations idempotently against a pool, then validate the result.
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
        label: 'recipe',
        expectedTables: expectedTables(),
        expectManifestSha: options.expectManifestSha,
    });
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
/**
 * A migration-manifest digest: 64 lowercase hex, anchored.
 *
 * ⛔ VALIDATED AT THE JSON BOUNDARY, not merely typed. A payload that spells the key differently, or one
 * the CLI mangled, yields `undefined` — and an unchecked `undefined` was a runner reporting a clean run
 * over whatever SQL it happens to hold, which is the exact state ADR-0035 exists to abolish.
 */
const MANIFEST_SHA = z.string().regex(/^[0-9a-f]{64}$/u, 'must be a 64-character lowercase hex sha256');

/**
 * The event this runner accepts.
 *
 * ⛔ `expectManifestSha` is REQUIRED for a MIGRATE, and correctly absent for a DROP — a drop names a
 * database, not a migration set, so there is nothing for it to expect. ADR-0035 rejects the optional form
 * by name: "an optional expectation is one a caller forgets, and a forgotten one is indistinguishable from
 * the behaviour it replaces".
 *
 * `action` is the only thing here that selects behaviour. The digest is an ASSERTION.
 */
const MigrateEventSchema = z
    .object({
        action: z.enum(['migrate', 'drop']).default('migrate'),
        expectManifestSha: MANIFEST_SHA.optional(),
    })
    .refine((event) => event.action === 'drop' || event.expectManifestSha !== undefined, {
        message: 'a migrate event must carry expectManifestSha — see ADR-0035',
        path: ['expectManifestSha'],
    });

/**
 * Lambda entrypoint. With no action (or `migrate`) it builds the pool from the DB env (authenticating as
 * `recipe_app` via an RDS IAM token) and runs + validates the migrations, creating the per-PR database
 * first if absent (ADR-0006). With `action: 'drop'` it drops the per-PR database (never the base).
 *
 * @param event - Optional `{ action, expectManifestSha }` (the action defaults to `migrate`).
 * @returns The migrate result, or the drop result when `action` is `drop`.
 * @sideEffect Connects to PostgreSQL (RDS IAM auth) and executes DDL.
 */
export const handler = async (event: unknown = {}): Promise<MigrateResult | { dropped: DropDatabaseResult }> => {
    const parsed = MigrateEventSchema.safeParse(event ?? {});

    if (!parsed.success) {
        throw new Error(
            `Recipe migration runner received a malformed event — ` +
                parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', '),
        );
    }

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

    if (parsed.data.action === 'drop') {
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
        return await runMigrations({
            pool,
            migrationsDir: bundledMigrationsDir(),
            // Non-null by construction: the schema's refine rejects a migrate event without it.
            expectManifestSha: parsed.data.expectManifestSha as string,
        });
    } finally {
        await pool.end();
    }
};
