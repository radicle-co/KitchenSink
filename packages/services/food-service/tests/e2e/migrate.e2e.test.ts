/**
 * Integration suite for the in-VPC migration runner (T-191 / FU-MIGRATE) over REAL Postgres. Exercises
 * the source-of-truth ordered `.sql` discovery, the idempotent skip-if-recorded apply tracked in
 * `schema_migrations`, the post-migration table-existence validation (a missing expected table throws,
 * surfacing as a Lambda FunctionError that fails the deploy step), and re-invoke safety.
 *
 * The handler's secret/env → Pool plumbing is exercised in production only; here we drive the testable
 * `runMigrations(pool, dir)` core directly against the PostgreSQL `DATABASE_ADMIN_URL` names.
 *
 * ⚠️ This suite's SUBJECT is the runner, not the service, so it keeps its own database and its own
 * migrator connection rather than the tier's shared `food_test` (which `tests/globalSetup.ts` has already
 * migrated — there would be nothing left for these cases to apply).
 *
 * @implements ARCH-001
 */
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    poolForDroppableDatabase,
    provisionRdsLikeDatabase,
    type RdsLikeDatabase,
} from '@kitchensink/service-test-harness';

import { discoverMigrations, ensureDatabaseExists, runMigrations } from '../../src/lambdas/migrate/handler.js';
import { ensureFoodRoleModel } from '../support/maintenanceDb.js';

// The digest of the very directory each call migrates. `expectManifestSha` is REQUIRED (ADR-0035), so
// passing it here is not ceremony: it makes these tests exercise the contract the deployed runner enforces
// rather than a laxer one that only exists in the test.
import { readMigrationManifest } from '@kitchensink/db-schema-guard';

const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/** Scratch directories this file created, removed in `afterAll` so a FAILING test still cleans up. */
const scratchDirectories: string[] = [];

afterAll(() => {
    for (const directory of scratchDirectories) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A throwaway migrations directory, registered for removal when this file's suites finish.
 *
 * @param prefix - The `mkdtemp` prefix, so a directory that does outlive a run names the suite that made it.
 * @returns The absolute path to the new directory.
 * @sideEffect Creates a directory under the OS temp directory.
 */
function scratchDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));

    scratchDirectories.push(directory);

    return directory;
}

/**
 * The ordered migration names, derived from the directory INDEPENDENTLY of `discoverMigrations` (so the
 * assertions below still test the runner rather than restating it). Adding a `.sql` file must not require
 * editing this suite — a hardcoded list here has already rotted twice, and each time it turned a
 * legitimately-applied migration into a red build with a misleading diff.
 */
function expectedMigrationNames(): string[] {
    return readdirSync(sourceMigrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => file.replace(/\.sql$/, ''));
}

/**
 * ⚠️ The runner runs as the production MIGRATOR against a database the production OWNER owns (role split,
 * `docs/plans/2026-09-11-database-role-split.md`) — never as a superuser. As a superuser, a runner that forgot
 * `SET ROLE`, or a grant the service role needs, would pass here and fail on a stage.
 *
 * Named `…_test` rather than `kitchensink_…`, which is the shape the per-PR reaper's census counts.
 */
const MIGRATE_IT_DATABASE = 'food_migrate_test';

describe('migrate runner (integration)', () => {
    let provisioned: RdsLikeDatabase;
    let pool: pg.Pool;

    beforeAll(async () => {
        provisioned = await provisionRdsLikeDatabase({
            roles: DATABASE_ROLES.food,
            database: MIGRATE_IT_DATABASE,
        });
        pool = new pg.Pool({ connectionString: provisioned.migratorUrl });
    });

    beforeEach(async () => {
        // Reset AS THE OWNER, so the recreated `public` is the owner's — as it is on a freshly created stage.
        await pool.query(`SET ROLE "${DATABASE_ROLES.food.owner}"`);
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await pool.query('RESET ROLE');
    });

    afterAll(async () => {
        await pool.end();
    });

    /** The runner's options for this suite's database. */
    const migrateOptions = (migrationsDir: string) => ({
        pool,
        migrationsDir,
        expectManifestSha: readMigrationManifest(migrationsDir).sha,
        database: MIGRATE_IT_DATABASE,
    });

    describe('discoverMigrations', () => {
        it('discovers every .sql migration in filename order (no hardcoded list)', () => {
            const names = discoverMigrations(sourceMigrationsDir).map((migration) => migration.name);

            expect(names).toEqual(expectedMigrationNames());
            // The base schema must be first, and the ordinal prefix must strictly increase.
            expect(names[0]).toBe('0000_food_schema');
            expect([...names].sort()).toEqual(names);
        });
    });

    describe('runMigrations', () => {
        it('applies every discovered migration in order and validates the expected tables exist', async () => {
            const expected = expectedMigrationNames();
            const result = await runMigrations(migrateOptions(sourceMigrationsDir));

            expect(result.applied).toEqual(expected);
            expect(result.skipped).toEqual([]);
            expect(result.validated.migrations).toBe(expected.length);
            expect(result.validated.tables).toBeGreaterThanOrEqual(13);

            const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

            expect(recorded.rows.map((row) => row.name)).toEqual([...expected].sort());
        });

        it('is idempotent — a re-invocation skips already-recorded migrations and applies nothing', async () => {
            await runMigrations(migrateOptions(sourceMigrationsDir));
            const second = await runMigrations(migrateOptions(sourceMigrationsDir));

            expect(second.applied).toEqual([]);
            expect(second.skipped).toEqual(expectedMigrationNames());
        });

        it('throws when an expected Drizzle-schema table is missing after applying the discovered SQL', async () => {
            const tempDir = scratchDirectory('food-migrate-');
            writeFileSync(join(tempDir, '0000_noop.sql'), 'SELECT 1;');

            // Since 0018 the table policy names catalog tables, and the engine checks those exist first: either
            // check failing is the post-migration validation refusing a schema the runner did not produce.
            await expect(runMigrations(migrateOptions(tempDir))).rejects.toThrow(
                /post-migration validation failed — (the table policy names tables that do not exist|tables missing)/u,
            );
        });

        it('leaves the service role with DML on every table and no DDL — the engine audit, as a stage sees it', async () => {
            await runMigrations(migrateOptions(sourceMigrationsDir));

            const app = new pg.Client({ connectionString: provisioned.appUrl });

            await app.connect();

            try {
                await expect(app.query('SELECT count(*) FROM food')).resolves.toBeDefined();
                await expect(app.query('CREATE TABLE evil (id int)')).rejects.toThrow(/permission denied/u);
                await expect(app.query("INSERT INTO schema_migrations (name) VALUES ('x')")).rejects.toThrow(
                    /permission denied/u,
                );
            } finally {
                await app.end();
            }
        });
    });

    describe('per-PR database lifecycle (ADR-0006)', () => {
        // A DB name distinct from the base and any other suite; connecting to it verifies isolation.
        // ⚠️ It KEEPS the `kitchensink_food_` prefix on purpose: `FOOD_DATABASE_NAME_PATTERN` in the runner
        // under test admits only `kitchensink_food(_suffix)`, so a `…_test` name here would test nothing.
        const perPrName = 'kitchensink_food_pr_ittest';
        // The runner's own maintenance connection: the MIGRATOR on `postgres`, which is who creates a per-PR
        // database on a stage. The MASTER pool only cleans up — dropping is the reaper's job (ADR-0031), and
        // its integration suite is where that is proven.
        let maintenancePool: pg.Pool;
        // ⛔ The master, not the migrator: `DROP DATABASE … WITH (FORCE)` terminates the sessions on the
        // target, which needs `pg_signal_backend` — the migrator does not have it (measured: "permission
        // denied to terminate process"), and the stand-in master does, exactly as RDS's master does.
        let master: pg.Pool;
        let base: RdsLikeDatabase;

        const dropPerPr = async (): Promise<void> => {
            await master.query(`DROP DATABASE IF EXISTS "${perPrName}" WITH (FORCE)`);
        };

        // The role model and the migrator's maintenance connection, as a stage's bootstrap leaves them. Bootstrapped
        // explicitly rather than relying on another suite having run first.
        beforeAll(async () => {
            base = await ensureFoodRoleModel();
            maintenancePool = new pg.Pool({ connectionString: base.migratorMaintenanceUrl, max: 1 });
            master = new pg.Pool({ connectionString: base.masterUrl, max: 1 });
        });

        beforeEach(dropPerPr);

        afterAll(async () => {
            await dropPerPr();
            await maintenancePool.end();
            await master.end();
        });

        it('never creates the shared base database', async () => {
            await expect(ensureDatabaseExists({ maintenancePool, databaseName: 'kitchensink_food' })).resolves.toBe(
                'skipped-base',
            );
        });

        it('creates the per-PR database OWNED BY THE OWNER, not by the migrator that ran the CREATE', async () => {
            await ensureDatabaseExists({ maintenancePool, databaseName: perPrName });

            const owner = await master.query<{ owner: string }>(
                'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
                [perPrName],
            );

            expect(owner.rows[0]?.owner).toBe(DATABASE_ROLES.food.owner);
        });

        /**
         * ⚠️ REWRITTEN for curated plan U7. A per-PR database is created EMPTY from `template0`, so the run that
         * follows applies every migration from nothing. The seed that fills it is proven in
         * `tests/e2e/perPrDatabaseCreation.e2e.test.ts`; this case owns the LIFECYCLE — create, idempotent
         * re-invoke, migrate into it.
         */
        it('creates the per-PR database empty, is idempotent, and migrates into it as the migrator', async () => {
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('created');
            // Re-invoke is a no-op.
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('exists');

            // Migrate INTO the fresh per-PR database (a separate connection).
            // ⚠️ Not a bare `new pg.Pool`. Three lines down this database is dropped WITH (FORCE), and
            // `pool.end()` resolves before the backend is actually gone — so the drop can terminate a
            // socket that is still closing and `pg` raises it as an unhandled pool-level error, failing a
            // run whose tests all passed. Measured in recipe-service; the same shape lives here.
            const perPrPool = poolForDroppableDatabase(base.urlFor(DATABASE_ROLES.food.migrator, perPrName));

            try {
                const result = await runMigrations({
                    pool: perPrPool,
                    migrationsDir: sourceMigrationsDir,
                    expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
                    database: perPrName,
                });

                // The runner discovers the full ordered set — every `.sql` in the directory, no exceptions
                // — and applies every one of them, because the database starts empty.
                expect(result.applied).toEqual(expectedMigrationNames());
                expect(result.skipped).toEqual([]);
                expect(result.validated.tables).toBeGreaterThanOrEqual(13);
            } finally {
                await perPrPool.end();
            }
        });
    });
});
