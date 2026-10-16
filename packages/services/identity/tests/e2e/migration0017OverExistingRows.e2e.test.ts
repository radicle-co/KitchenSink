/**
 * Migration `0017_users_provider_deleted_at`, applied OVER ROWS THAT ALREADY EXIST.
 *
 * ⛔ WHY THIS TIER. Every other migration suite builds the schema on an empty database, where an
 * `ADD CONSTRAINT … CHECK` cannot fail. The sandbox database was not empty: migration 0012 had already stamped
 * `reconciled_at` on erased rows, before `provider_deleted_at` existed, so 0017's
 * `CHECK (reconciled_at IS NULL OR provider_deleted_at IS NOT NULL)` failed to add and the runner threw
 * `Migration 0017_users_provider_deleted_at failed`. This suite reproduces that state — migrations 0001..0016,
 * an erased row already reconciled — and then applies the whole chain.
 *
 * The repair's meaning: no existing row has a provider-deletion confirmation, so none may stay reconciled; the
 * nightly reconciliation re-verifies each such row once (0012's own semantics) and now also confirms Clerk.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DATABASE_ROLES, readMigrationManifest } from '@kitchensink/db-schema-guard';
import { provisionRdsLikeDatabase } from '@kitchensink/service-test-harness';

import { runMigrations } from '../../src/lambdas/migrate/handler.js';
import { migrationsDir } from '../support/roleDb.js';

const DATABASE = 'identity_migrate_0017_test';

/** The last migration that existed on the sandbox before 0017. */
const LAST_BEFORE = '0016_profiles_username';

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A directory holding the real migrations up to and including `last`.
 *
 * @param last - The final migration name (no extension) to include.
 * @returns The directory path.
 * @sideEffect Creates and fills a temp directory.
 */
function migrationsThrough(last: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'identity-0017-'));
    scratch.push(directory);
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .filter((file) => file.replace(/\.sql$/, '') <= last);
    for (const file of files) {
        copyFileSync(join(migrationsDir, file), join(directory, file));
    }

    return directory;
}

describe('0017_users_provider_deleted_at over an already-populated database', () => {
    let pool: pg.Pool;

    beforeAll(async () => {
        const provisioned = await provisionRdsLikeDatabase({ roles: DATABASE_ROLES.identity, database: DATABASE });
        pool = new pg.Pool({ connectionString: provisioned.migratorUrl });
    });

    beforeEach(async () => {
        await pool.query(`SET ROLE "${DATABASE_ROLES.identity.owner}"`);
        await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await pool.query('RESET ROLE');
    });

    afterAll(async () => {
        await pool?.end();
    });

    it('applies, and un-reconciles an erased row that was reconciled before the provider stamp existed', async () => {
        const before = migrationsThrough(LAST_BEFORE);
        await runMigrations({
            pool,
            migrationsDir: before,
            expectManifestSha: readMigrationManifest(before).sha,
            database: DATABASE,
        });
        await pool.query(`SET ROLE "${DATABASE_ROLES.identity.owner}"`);
        await pool.query(
            `INSERT INTO users (id, identity_id, email, status, reconciled_at)
             VALUES ('u_old', 'user_old', 'old@example.com', 'erased', '2026-10-01T00:00:00Z'),
                    ('u_live', 'user_live', 'live@example.com', 'active', NULL)`,
        );
        await pool.query('RESET ROLE');

        const result = await runMigrations({
            pool,
            migrationsDir,
            expectManifestSha: readMigrationManifest(migrationsDir).sha,
            database: DATABASE,
        });

        expect(result.applied).toContain('0017_users_provider_deleted_at');
        const { rows } = await pool.query<{
            id: string;
            reconciled_at: string | null;
            provider_deleted_at: string | null;
        }>('SELECT id, reconciled_at, provider_deleted_at FROM users ORDER BY id');
        expect(rows).toEqual([
            { id: 'u_live', reconciled_at: null, provider_deleted_at: null },
            { id: 'u_old', reconciled_at: null, provider_deleted_at: null },
        ]);
    });
});
