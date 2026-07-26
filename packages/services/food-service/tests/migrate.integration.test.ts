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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import {
    discoverMigrations,
    dropDatabase,
    ensureDatabaseExists,
    runMigrations,
} from '../src/lambdas/migrate/handler.js';
import { DATABASE_URL } from './support/db.js';

const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

describe.skipIf(!DATABASE_URL)('migrate runner (integration)', () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    beforeEach(async () => {
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });

    afterAll(async () => {
        await pool.end();
    });

    describe('discoverMigrations', () => {
        it('discovers the ordered .sql migrations from the source dir (0000, 0001, 0002 — no hardcoded list)', () => {
            const names = discoverMigrations(sourceMigrationsDir).map((migration) => migration.name);

            expect(names).toEqual(['0000_food_schema', '0001_food_fts', '0002_fetch_requesters_rekey']);
        });
    });

    describe('runMigrations', () => {
        it('applies every discovered migration in order and validates the expected tables exist', async () => {
            const result = await runMigrations({ pool, migrationsDir: sourceMigrationsDir });

            expect(result.applied).toEqual(['0000_food_schema', '0001_food_fts', '0002_fetch_requesters_rekey']);
            expect(result.skipped).toEqual([]);
            expect(result.validated.migrations).toBe(3);
            expect(result.validated.tables).toBeGreaterThanOrEqual(13);

            const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

            expect(recorded.rows.map((row) => row.name)).toEqual([
                '0000_food_schema',
                '0001_food_fts',
                '0002_fetch_requesters_rekey',
            ]);
        });

        it('is idempotent — a re-invocation skips already-recorded migrations and applies nothing', async () => {
            await runMigrations({ pool, migrationsDir: sourceMigrationsDir });
            const second = await runMigrations({ pool, migrationsDir: sourceMigrationsDir });

            expect(second.applied).toEqual([]);
            expect(second.skipped).toEqual(['0000_food_schema', '0001_food_fts', '0002_fetch_requesters_rekey']);
        });

        it('throws when an expected Drizzle-schema table is missing after applying the discovered SQL', async () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'food-migrate-'));
            writeFileSync(join(tempDir, '0000_noop.sql'), 'SELECT 1;');

            await expect(runMigrations({ pool, migrationsDir: tempDir })).rejects.toThrow(/tables missing/i);
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

        it('creates the per-PR database, is idempotent, migrates into it, then drops it', async () => {
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('created');
            // Re-invoke is a no-op.
            expect(await ensureDatabaseExists({ maintenancePool, databaseName: perPrName })).toBe('exists');

            // Migrate INTO the freshly created per-PR database (a separate connection).
            const perPrPool = new pg.Pool({ connectionString: perPrConnectionString() });

            try {
                const result = await runMigrations({ pool: perPrPool, migrationsDir: sourceMigrationsDir });

                // The runner discovers the full ordered set — including 0002 (CR-002/U1 requester rekey).
                expect(result.applied).toEqual(['0000_food_schema', '0001_food_fts', '0002_fetch_requesters_rekey']);
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
