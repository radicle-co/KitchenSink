/**
 * Migration 0087 applied OVER A DATABASE THAT ALREADY HOLDS A RECIPE WITH A STATED SOURCE, asserted against a real PostgreSQL.
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the CHECK that pairs `source_kind` with `statement_kind = 'source'` refuses any row that
 * states a source and no statement. Every recipe stored before 0087 is such a row, so a migration that adds the CHECK without
 * first writing `statement_kind` fails the deploy on any database that holds one. A suite that migrates an EMPTY database
 * (every other suite here) cannot observe that. This one migrates to 0085, stores a web copy, and applies the rest.
 */
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DATABASE_ROLES, NO_TABLE_POLICY, applyMigrations, readMigrationManifest } from '@kitchensink/db-schema-guard';
import {
    poolForDroppableDatabase,
    provisionRdsLikeDatabase,
    type RdsLikeDatabase,
} from '@kitchensink/service-test-harness';

import { ensureDatabaseExists, runMigrations } from '../../../src/lambdas/migrate/handler.js';

const TEST_DATABASE = 'kitchensink_recipes_backfill';
const RECIPE_ID = '77777777-7777-4777-8777-000000000e01';
const sourceMigrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../src/database/migrations');

describe('migration 0087 over a recipe that already states a source', () => {
    let provisioned: RdsLikeDatabase;
    let master: pg.Pool;
    let maintenancePool: pg.Pool;
    let pool: pg.Pool;
    let beforeDir: string;

    beforeAll(async () => {
        provisioned = await provisionRdsLikeDatabase({
            roles: DATABASE_ROLES.recipe,
            database: TEST_DATABASE,
            createDatabase: false,
        });
        master = new pg.Pool({ connectionString: provisioned.masterUrl, max: 1 });
        await master.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
        maintenancePool = new pg.Pool({ connectionString: provisioned.migratorMaintenanceUrl, max: 1 });
        await ensureDatabaseExists({ maintenancePool, databaseName: TEST_DATABASE });
        pool = poolForDroppableDatabase(provisioned.urlFor(DATABASE_ROLES.recipe.migrator, TEST_DATABASE));

        // A migrations directory holding everything BEFORE 0086: the state of a database that predates the evidence table.
        beforeDir = mkdtempSync(join(tmpdir(), 'recipeBackfill-'));

        for (const file of readdirSync(sourceMigrationsDir).filter((name) => name.endsWith('.sql'))) {
            if (file < '0086') {
                symlinkSync(join(sourceMigrationsDir, file), join(beforeDir, file));
            }
        }
    });

    afterAll(async () => {
        rmSync(beforeDir, { recursive: true, force: true });
        await pool.end();
        await maintenancePool.end();
        await master.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`);
        await master.end();
    });

    it('applies cleanly and gives the stored web copy the statement its source implies', async () => {
        // The runner's own engine, with only the table this case needs: the drizzle barrel names tables the older set does not yet create.
        await applyMigrations({
            pool,
            migrationsDir: beforeDir,
            label: 'recipe',
            expectedTables: ['recipes'],
            expectManifestSha: readMigrationManifest(beforeDir).sha,
            database: TEST_DATABASE,
            roles: DATABASE_ROLES.recipe,
            tablePolicy: NO_TABLE_POLICY,
        });

        const client = await pool.connect();

        try {
            await client.query(`SET ROLE "${DATABASE_ROLES.recipe.owner}"`);
            await client.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, source_type, source_kind, source_url)
                 VALUES ($1, 'backfill-owner', 'A stored web copy', '', 1, 1, 2, 4, 'private', 'draft',
                         'imported_public', 'public_web', 'https://example.com/r')`,
                [RECIPE_ID],
            );
            await client.query('RESET ROLE');
        } finally {
            client.release();
        }

        const result = await runMigrations({
            pool,
            migrationsDir: sourceMigrationsDir,
            expectManifestSha: readMigrationManifest(sourceMigrationsDir).sha,
            database: TEST_DATABASE,
        });

        expect(result.applied).toContain('0087_recipe_statement_kind');

        const { rows } = await pool.query<{ statement_kind: string | null; source_kind: string | null }>(
            `SELECT statement_kind, source_kind FROM recipes WHERE id = $1`,
            [RECIPE_ID],
        );

        expect(rows).toEqual([{ statement_kind: 'source', source_kind: 'public_web' }]);
    });
});
