/**
 * Integration suite for the in-VPC migration runner (T-191 / FU-MIGRATE) over REAL Postgres. Exercises
 * the source-of-truth ordered `.sql` discovery, the idempotent skip-if-recorded apply tracked in
 * `schema_migrations`, the post-migration table-existence validation (a missing expected table throws,
 * surfacing as a Lambda FunctionError that fails the deploy step), and re-invoke safety.
 *
 * The handler's secret/env → Pool plumbing is exercised in production only; here we drive the testable
 * `runMigrations(pool, dir)` core directly against the Docker Postgres the integration run provides.
 *
 * @implements ARCH-001
 */
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    discoverMigrations,
    dropDatabase,
    ensureDatabaseExists,
    runMigrations,
} from '../src/lambdas/migrate/handler.js';
import { DATABASE_URL } from './support/db.js';
import { ensureSeededBaseDatabase } from './support/maintenanceDb.js';
import { poolForDroppableDatabase } from '@kitchensink/service-test-harness';

// The digest of the very directory each call migrates. `expectManifestSha` is REQUIRED (ADR-0035), so
// passing it here is not ceremony: it makes these tests exercise the contract the deployed runner enforces
// rather than a laxer one that only exists in the test.
import { readMigrationManifest } from '@kitchensink/db-schema-guard';

const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

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

describe.skipIf(!DATABASE_URL)('migrate runner (integration)', () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    beforeEach(async () => {
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('discoverMigrations', () => {
        it('discovers every .sql migration in filename order (no hardcoded list)', () => {
            const names = discoverMigrations(sourceMigrationsDir).map((migration) => migration.name);

            expect(names).toEqual(expectedMigrationNames());
            // The base schema must be first, and the ordinal prefix must strictly increase.
            expect(names[0]).toBe('0000_food_schema');
            expect([...names].sort()).toEqual(names);
        });

        it('includes the food.origin migration (the F-C2 change-refresh exclusion marker)', () => {
            const names = discoverMigrations(sourceMigrationsDir).map((migration) => migration.name);

            expect(names).toContain('0003_food_origin');
        });
    });

    describe('runMigrations', () => {
        it('applies every discovered migration in order and validates the expected tables exist', async () => {
            const expected = expectedMigrationNames();
            const result = await runMigrations({
                pool,
                migrationsDir: sourceMigrationsDir,
                expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
            });

            expect(result.applied).toEqual(expected);
            expect(result.skipped).toEqual([]);
            expect(result.validated.migrations).toBe(expected.length);
            expect(result.validated.tables).toBeGreaterThanOrEqual(13);

            const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

            expect(recorded.rows.map((row) => row.name)).toEqual([...expected].sort());
        });

        it('is idempotent — a re-invocation skips already-recorded migrations and applies nothing', async () => {
            await runMigrations({
                pool,
                migrationsDir: sourceMigrationsDir,
                expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
            });
            const second = await runMigrations({
                pool,
                migrationsDir: sourceMigrationsDir,
                expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
            });

            expect(second.applied).toEqual([]);
            expect(second.skipped).toEqual(expectedMigrationNames());
        });

        it('throws when an expected Drizzle-schema table is missing after applying the discovered SQL', async () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'food-migrate-'));
            writeFileSync(join(tempDir, '0000_noop.sql'), 'SELECT 1;');

            await expect(
                runMigrations({ pool, migrationsDir: tempDir, expectManifestSha: readMigrationManifest(tempDir).sha }),
            ).rejects.toThrow(/tables missing/i);
        });
    });

    describe('per-PR database lifecycle (ADR-0006)', () => {
        // A DB name distinct from the base and any other suite; connecting to it verifies isolation.
        const perPrName = 'kitchensink_food_pr_ittest';
        // The maintenance pool connects to a DIFFERENT database so CREATE/DROP DATABASE are permitted.
        const maintenancePool = new pg.Pool({ connectionString: DATABASE_URL });

        const perPrConnectionString = (): string => {
            const url = new URL(DATABASE_URL as string);
            url.pathname = `/${perPrName}`;

            return url.toString();
        };

        // U38: a per-PR database is CLONED from the base, so the base must exist here as it does on a
        // deployed stage. Bootstrapped explicitly rather than relying on another suite having run first.
        beforeAll(async () => {
            await ensureSeededBaseDatabase();
        });

        beforeEach(async () => {
            await dropDatabase({ maintenancePool, databaseName: perPrName });
        });

        afterAll(async () => {
            await dropDatabase({ maintenancePool, databaseName: perPrName });
            await maintenancePool.end();
        });

        it('never creates or drops the shared base database', async () => {
            await expect(ensureDatabaseExists({ maintenancePool, databaseName: 'kitchensink_food' })).resolves.toBe(
                'skipped-base',
            );
            await expect(dropDatabase({ maintenancePool, databaseName: 'kitchensink_food' })).resolves.toBe(
                'skipped-base',
            );
        });

        /**
         * ⚠️ REWRITTEN for U38, not relaxed. This used to assert `'created'` and a full `applied` list —
         * the shape of an EMPTY database being migrated from nothing. A per-PR database is now cloned
         * from the seeded base, so it arrives WITH the base's `schema_migrations` history and the run
         * that follows correctly applies nothing. The warm-start guarantee itself (the base's ROWS
         * arriving, and the loud failure when the template is held) is proven in
         * `migrateTemplateClone.integration.test.ts`; what this case still owns is the LIFECYCLE —
         * clone, idempotent re-invoke, migrate into it, force-drop, idempotent re-drop.
         */
        it('clones the per-PR database, is idempotent, migrates into it, then drops it', async () => {
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('cloned');
            // Re-invoke is a no-op.
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('exists');

            // Migrate INTO the freshly cloned per-PR database (a separate connection).
            // ⚠️ Not a bare `new pg.Pool`. Three lines down this database is dropped WITH (FORCE), and
            // `pool.end()` resolves before the backend is actually gone — so the drop can terminate a
            // socket that is still closing and `pg` raises it as an unhandled pool-level error, failing a
            // run whose tests all passed. Measured in recipe-service; the same shape lives here.
            const perPrPool = poolForDroppableDatabase(perPrConnectionString());

            try {
                const result = await runMigrations({
                    pool: perPrPool,
                    migrationsDir: sourceMigrationsDir,
                    expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
                });

                // The runner discovers the full ordered set — every `.sql` in the directory, no exceptions
                // — and finds every one of them already recorded, carried over by the clone.
                expect(result.skipped).toEqual(expectedMigrationNames());
                expect(result.applied).toEqual([]);
                expect(result.validated.tables).toBeGreaterThanOrEqual(13);
            } finally {
                await perPrPool.end();
            }

            // Drop reclaims it (force-terminates lingering connections), and is idempotent.
            expect(await dropDatabase({ maintenancePool, databaseName: perPrName })).toBe('dropped');
            expect(await dropDatabase({ maintenancePool, databaseName: perPrName })).toBe('absent');
        });
    });
});
