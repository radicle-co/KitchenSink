/**
 * Integration suite for the identity in-VPC migration runner, over REAL Postgres.
 *
 * This is the tier that matters for this runner. A mocked pool proves the code calls the mock; only a
 * real database can show that the ordered `.sql` in `src/database/migrations` actually BUILDS the schema
 * `@kitchensink/identity-db` declares — which is exactly what the runner asserts before it lets the
 * deploy proceed, and exactly what a fresh stage depends on. It also pins the two properties the
 * in-deploy trigger relies on: a re-invocation applies nothing (so re-running is free), and a failing
 * migration rolls back and stays unrecorded (so a half-applied schema can never read as done).
 *
 * Runs against the identity integration DATABASE_URL (CI provides one; locally set it). Skips cleanly
 * when unset — the identity integration suite's existing convention (`createUserFlow.integration.test.ts`).
 */
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { discoverMigrations, runMigrations } from '../src/lambdas/migrate/handler.js';

// The digest of the very directory each call migrates. `expectManifestSha` is REQUIRED (ADR-0035), so
// passing it here is not ceremony: it makes these tests exercise the contract the deployed runner enforces
// rather than a laxer one that only exists in the test.
import { readMigrationManifest } from '@kitchensink/db-schema-guard';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The single source of truth for identity's schema — the directory esbuild copies into the bundle. */
const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

/**
 * The ordered migration names, derived from the directory INDEPENDENTLY of `discoverMigrations`, so the
 * assertions below test the runner rather than restate it. Adding a `.sql` must not require editing this
 * suite.
 *
 * @returns The expected migration tracking names, in apply order.
 * @sideEffect Reads the migrations directory.
 */
function expectedMigrationNames(): string[] {
    return readdirSync(sourceMigrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => file.replace(/\.sql$/, ''));
}

/** Every table `@kitchensink/identity-db` declares — the set the runner validates against. */
const DECLARED_TABLES = ['users', 'accounts', 'profiles', 'webhook_events', 'lifecycle_events'] as const;

describe.skipIf(!DATABASE_URL)('identity migration runner (integration)', () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    beforeEach(async () => {
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    });

    afterAll(async () => {
        await pool.end();
    });

    it('discovers every .sql migration in filename order (no hardcoded list)', () => {
        const names = discoverMigrations(sourceMigrationsDir).map((migration) => migration.name);

        expect(names).toEqual(expectedMigrationNames());
        expect(names.length).toBeGreaterThan(0);
        expect([...names].sort()).toEqual(names);
    });

    it('builds the whole declared schema from a blank database and records every migration', async () => {
        const expected = expectedMigrationNames();
        const result = await runMigrations({
            pool,
            migrationsDir: sourceMigrationsDir,
            expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
        });

        expect(result.applied).toEqual(expected);
        expect(result.skipped).toEqual([]);
        expect(result.validated.migrations).toBe(expected.length);
        expect(result.validated.tables).toBe(DECLARED_TABLES.length);

        const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

        expect(recorded.rows.map((row) => row.name)).toEqual([...expected].sort());

        // The point of the whole runner: the tables the SERVICE reads must exist afterwards. Read out of
        // the catalog rather than trusting the runner's own count, which is the number under test.
        const present = await pool.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
        );
        const names = present.rows.map((row) => row.table_name);

        for (const table of DECLARED_TABLES) {
            expect(names, `${table} must exist after the migration chain`).toContain(table);
        }
    });

    it('is idempotent — a re-invocation skips everything and applies nothing', async () => {
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

    it('throws when the applied SQL does not produce a table the drizzle schema declares', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'identity-migrate-'));
        writeFileSync(join(dir, '0000_noop.sql'), 'SELECT 1;');

        await expect(
            runMigrations({ pool, migrationsDir: dir, expectManifestSha: readMigrationManifest(dir).sha }),
        ).rejects.toThrow(/tables missing/i);
    });

    it('rolls a failing migration back and leaves it UNRECORDED, so the next run retries it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'identity-migrate-'));
        writeFileSync(join(dir, '0000_ok.sql'), 'CREATE TABLE probe (id INT PRIMARY KEY);');
        writeFileSync(join(dir, '0001_broken.sql'), 'CREATE TABLE broken (id INT); SELECT undefined_column;');

        await expect(
            runMigrations({ pool, migrationsDir: dir, expectManifestSha: readMigrationManifest(dir).sha }),
        ).rejects.toThrow(/0001_broken/);

        const recorded = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

        expect(recorded.rows.map((row) => row.name)).toEqual(['0000_ok']);

        // The failed migration's own DDL must not have survived its rollback.
        const broken = await pool.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'broken'",
        );

        expect(broken.rows[0]?.count).toBe('0');
    });
});
