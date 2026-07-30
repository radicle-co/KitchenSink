import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Context } from 'aws-lambda';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import * as schema from '@kitchensink/identity-db';

import { getConfig } from '../config/env.js';
import { getJsonSecret } from '../common/secrets.js';
import { withObservability } from '../common/observability.js';

// Migrations are plain ordered .sql (not drizzle-kit's journal). identity-service owns the files;
// esbuild copies them into dist/migrations/ at build (see esbuild.mjs) and they're read here at
// runtime — no cross-package import. Each runs once, tracked in `schema_migrations`, so re-invoking
// is a no-op and the destructive reset in 0005 never re-runs.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Discover migrations from the bundled SQL rather than a hardcoded list — add a .sql file and it is
// picked up automatically (sorted by the numeric filename prefix for deterministic order).
const discoverMigrations = (): { name: string; file: string }[] =>
    readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((file) => ({ name: file.replace(/\.sql$/, ''), file }));

// Expected tables are derived from the drizzle schema definition (every exported pgTable), not
// hardcoded — so post-migration validation tracks the schema as it evolves.
const expectedTables = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => getTableName(table));

interface DbSecret {
    username: string;
    password: string;
    host: string;
    port: number | string;
    dbname?: string;
    database?: string;
}

export interface MigrateResult {
    applied: string[];
    skipped: string[];
    validated: { migrations: number; tables: number };
}

/**
 * In-VPC migration runner. Applies the identity schema migrations to RDS in order, idempotently,
 * then validates the result. Invoked from the deploy pipeline (it cannot reach the private-isolated
 * DB from GitHub Actions); a thrown error surfaces as a Lambda FunctionError and fails the deploy.
 *
 * @sideEffect Connects to PostgreSQL and executes DDL.
 */
const migrateCore = async (_event: unknown, _context: Context): Promise<MigrateResult> => {
    // Resolved (and cached) via the typed config as the first statement — S-I5: a missing DB_SECRET_ARN
    // now fails fast on the first invocation of a cold container, rather than a hand-rolled requireEnv.
    const { DB_SECRET_ARN, STAGE } = getConfig();
    const secret = (await getJsonSecret(DB_SECRET_ARN)) as unknown as DbSecret;
    const database = secret.dbname ?? secret.database;

    if (!database) {
        throw new Error(`Database secret '${DB_SECRET_ARN}' missing dbname/database`);
    }

    const pool = new Pool({
        user: secret.username,
        password: secret.password,
        host: secret.host,
        port: Number(secret.port),
        database,
        ssl: STAGE === 'local' ? false : { rejectUnauthorized: false },
        max: 1,
    });

    const migrations = discoverMigrations();
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

        // Post-migration validation. Throwing surfaces as a Lambda FunctionError, which fails the
        // deploy's migration step — so a partially-applied or drifted schema never passes silently.
        // Both sides are derived (migration files + drizzle schema), so nothing here is hardcoded.
        const recorded = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
        const recordedNames = new Set(recorded.rows.map((row) => row.name));
        const missingMigrations = migrations
            .map((migration) => migration.name)
            .filter((name) => !recordedNames.has(name));

        if (missingMigrations.length > 0) {
            throw new Error(
                `Post-migration validation failed — migrations not recorded: ${missingMigrations.join(', ')}`,
            );
        }

        const present = await client.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
            [expectedTables],
        );
        const presentTables = new Set(present.rows.map((row) => row.table_name));
        const missingTables = expectedTables.filter((table) => !presentTables.has(table));

        if (missingTables.length > 0) {
            throw new Error(`Post-migration validation failed — tables missing: ${missingTables.join(', ')}`);
        }

        return { applied, skipped, validated: { migrations: migrations.length, tables: expectedTables.length } };
    } finally {
        client.release();
        await pool.end();
    }
};

/** @implements S-I7 — parity with the other three handlers (identityWebhook, deletion-worker, reconciliation). */
export const handler = withObservability(migrateCore);
