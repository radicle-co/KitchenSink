/**
 * In-VPC schema migration runner for `kitchensink_food` (T-191 / FU-MIGRATE). Mirrors the identity
 * `migrate.ts`: the RDS instance is PRIVATE_ISOLATED, so the deploy pipeline (outside the VPC) invokes
 * this VPC-attached Lambda to apply the ordered SQL. Each migration runs once, tracked in
 * `schema_migrations`, so re-invoking is a no-op; a thrown error surfaces as a Lambda FunctionError and
 * fails the deploy's migration step (so a partial/drifted schema never passes silently).
 *
 * AUTH — `food_app` authenticates passwordlessly via RDS IAM (feature 003): no secret to read. The
 * connection target comes from env (`FOOD_DB_ENDPOINT`/`FOOD_DB_PORT`/`FOOD_DB_NAME`) and the IAM token
 * is minted per connection by {@link foodPoolConfig}. The lambda role holds `rds-db:connect` on the
 * `food_app` db-user (granted in the food service stack).
 *
 * @implements ARCH-001
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { z } from 'zod';

import { applyMigrations, assertBundleMatches } from '@kitchensink/db-schema-guard';
import type { MigrateResult } from '@kitchensink/db-schema-guard';

import { FOOD_DB_USERNAME, foodPoolConfig } from '../../database/poolConfig.js';
import * as schema from '../../db/schema/index.js';
import { FoodDatabaseCloneError, type FoodDatabaseCloneFailure } from './migrate.errors.js';

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
export type EnsureDatabaseResult = 'skipped-base' | 'exists' | 'cloned';

/**
 * Ensure a per-PR food logical database exists, CLONING it from the seeded base if absent (ADR-0006,
 * U38). The base database (`kitchensink_food`) is provisioned by the platform DataStack bootstrap and
 * seeded once from the USDA bulk download, so this is a no-op for it. For a per-PR name it validates the
 * identifier, checks `pg_database`, and issues `CREATE DATABASE … TEMPLATE` if missing. Idempotent and
 * re-invoke-safe: an already-present database returns `'exists'` and is left untouched, and a concurrent
 * creator that wins the race (SQLSTATE 42P04) is also treated as `'exists'`.
 *
 * **Why a clone rather than an empty database.** The per-PR database used to come up migrated but EMPTY,
 * which degraded every ingredient search in that preview to `catalogAvailability: 'unavailable'` behind
 * green checks. The clone hands the preview the base's catalog — and its `schema_migrations` history, so
 * the migration run that follows applies only what the base has not yet seen.
 *
 * ⛔ **The clone can be REFUSED, and a refusal is fatal.** PostgreSQL will not copy a database any
 * session is connected to; the base is expected to have none (there is no persistent non-prod food
 * service), but that is a premise to GUARD, not assume. A refusal raises `FoodDatabaseCloneError` and
 * fails the deploy — it is never softened into creating the database empty, which is exactly the silent
 * failure ADR-0010 exists to prevent.
 *
 * @param options - The maintenance pool + the target database name.
 * @returns `'skipped-base'` for the base DB, `'exists'` if already present, `'cloned'` if created.
 * @throws {Error} when the database name is not a valid food logical-database name.
 * @throws {FoodDatabaseCloneError} when the base could not be cloned (held, absent, or not permitted).
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

    // CREATE DATABASE cannot run inside a transaction and cannot be parameterized. Both identifiers are
    // fixed or validated against FOOD_DATABASE_NAME_PATTERN (no quotes/backslashes possible), so quoting
    // them is injection-safe.
    try {
        await maintenancePool.query(`CREATE DATABASE "${databaseName}" TEMPLATE "${BASE_FOOD_DATABASE_NAME}"`);
    } catch (err) {
        // The pg_database check above is a TOCTOU window: a concurrent invocation can create the
        // database between our SELECT and this CREATE, making CREATE DATABASE throw `duplicate_database`
        // (SQLSTATE 42P04). The database now exists — the desired end state — so treat that one code as
        // success rather than failing the whole migration run.
        if (sqlStateOf(err) === DUPLICATE_DATABASE_SQLSTATE) {
            return 'exists';
        }

        const reason = CLONE_FAILURE_BY_SQLSTATE[sqlStateOf(err) ?? ''];

        // ⛔ Classified or not, this THROWS. There is deliberately no branch here that creates the
        // database without the template: a per-PR catalog that is present and empty passes every check
        // this repo runs and is discovered only by a person whose ingredient search returns nothing.
        if (reason === undefined) {
            throw err;
        }

        throw new FoodDatabaseCloneError(databaseName, BASE_FOOD_DATABASE_NAME, reason, err);
    }

    return 'cloned';
}

/** Postgres SQLSTATE for `duplicate_database`, raised when `CREATE DATABASE` names an existing DB. */
const DUPLICATE_DATABASE_SQLSTATE = '42P04';

/**
 * The SQLSTATEs a refused `CREATE DATABASE … TEMPLATE` arrives as, mapped to the operator-facing reason.
 * `55006` is `object_in_use` ("source database … is being accessed by other users"), `3D000` is
 * `invalid_catalog_name` (no such template), `42501` is `insufficient_privilege` (copying a
 * non-template database requires ownership of the source).
 */
const CLONE_FAILURE_BY_SQLSTATE: Readonly<Record<string, FoodDatabaseCloneFailure | undefined>> = {
    '55006': 'template-in-use',
    '3D000': 'template-missing',
    '42501': 'insufficient-privilege',
};

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
 * `food_app` via an RDS IAM token — no secret) and runs + validates the migrations, creating the per-PR
 * database first if it is absent (ADR-0006). With `action: 'drop'` it drops the per-PR database (never
 * the base) for PR-close cleanup.
 *
 * @param event - Optional `{ action, expectManifestSha }` (the action defaults to `migrate`).
 * @returns The migrate result, or the drop result when `action` is `drop`.
 * @sideEffect Connects to PostgreSQL (RDS IAM auth) and executes DDL.
 */
export const handler = async (event: unknown = {}): Promise<MigrateResult | { dropped: DropDatabaseResult }> => {
    const parsed = MigrateEventSchema.safeParse(event ?? {});

    if (!parsed.success) {
        throw new Error(
            `Food migration runner received a malformed event — ` +
                parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', '),
        );
    }

    const host = requireEnv('FOOD_DB_ENDPOINT');
    const port = Number(requireEnv('FOOD_DB_PORT'));
    const databaseName = requireEnv('FOOD_DB_NAME');

    // Fail fast on a malformed port — Number('abc'/'5432\n') → NaN, which would otherwise surface as a
    // confusing connection error deep in pg.
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid FOOD_DB_PORT "${process.env['FOOD_DB_PORT']}" — expected a TCP port (1-65535).`);
    }

    // Validate up front (defense in depth — ensureDatabaseExists/dropDatabase also validate): the name
    // must match the food logical-database contract before we connect to / create / drop it.
    if (!isValidFoodDatabaseName(databaseName)) {
        throw new Error(`Refusing to migrate: invalid FOOD_DB_NAME "${databaseName}".`);
    }

    const withMaintenancePool = async <T>(run: (pool: pg.Pool) => Promise<T>): Promise<T> => {
        const maintenancePool = new Pool({
            ...foodPoolConfig({ host, port, database: 'postgres', username: FOOD_DB_USERNAME }),
            max: 1,
        });

        try {
            return await run(maintenancePool);
        } finally {
            await maintenancePool.end();
        }
    };

    // ⛔ BEFORE ANY SIDE EFFECT, and before the drop branch below. A `migrate` that will CREATE a per-PR
    // logical database (ADR-0006) must not create one and only then discover it is the wrong release's
    // runner: that leaves an empty, unmigrated database behind for the reaper to find. `applyMigrations`
    // makes the same assertion, and this is the only way its "refuse before touching anything" claim can be
    // true for a handler that does work in front of it.
    if (parsed.data.action !== 'drop') {
        assertBundleMatches({
            label: 'food',
            migrationsDir: bundledMigrationsDir(),
            // Non-null by construction: the schema's refine rejects a migrate event without it.
            expectManifestSha: parsed.data.expectManifestSha as string,
        });
    }

    if (parsed.data.action === 'drop') {
        const dropped = await withMaintenancePool((pool) => dropDatabase({ maintenancePool: pool, databaseName }));

        return { dropped };
    }

    // Per-PR isolation (ADR-0006): a per-PR stage targets `kitchensink_food_pr_{N}`, which the platform
    // bootstrap does NOT create. CLONE it from the seeded base (via the maintenance DB) if absent BEFORE
    // migrating into it, so the preview starts with a populated catalog rather than an empty one (U38).
    // The base `kitchensink_food` short-circuits (skipped-base), so the prod/sandbox path is unchanged.
    if (databaseName !== BASE_FOOD_DATABASE_NAME) {
        await withMaintenancePool((pool) => ensureDatabaseExists({ maintenancePool: pool, databaseName }));
    }

    const pool = new Pool({
        ...foodPoolConfig({ host, port, database: databaseName, username: FOOD_DB_USERNAME }),
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
