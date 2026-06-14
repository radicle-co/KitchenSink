import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { requireEnv } from '../common/config.js';
import { getJsonSecret } from '../common/secrets.js';

// Ordered raw-SQL migrations (this project applies plain .sql, not drizzle-kit's journal). The .sql
// is owned by identity-service; esbuild copies it into dist/migrations/ at build (see esbuild.mjs)
// and it is read here at runtime — no cross-package import. Each runs once, tracked in
// `schema_migrations`, so re-invoking is a no-op and the destructive reset in 0005 never re-runs.
const MIGRATION_NAMES = [
    '0004_users_sub_pk',
    '0005_identity_reset',
    '0006_webhook_idempotency',
    '0007_webhook_events_ttl',
] as const;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

interface DbSecret {
    username: string;
    password: string;
    host: string;
    port: number | string;
    dbname?: string;
    database?: string;
}

interface MigrateResult {
    applied: string[];
    skipped: string[];
}

/**
 * In-VPC migration runner. Applies the identity schema migrations to RDS in order, idempotently.
 * Invoked from the deploy pipeline (it cannot reach the private-isolated DB from GitHub Actions).
 *
 * @sideEffect Connects to PostgreSQL and executes DDL.
 */
export const handler = async (): Promise<MigrateResult> => {
    const dbSecretArn = requireEnv('DB_SECRET_ARN');
    const secret = (await getJsonSecret(dbSecretArn)) as unknown as DbSecret;
    const database = secret.dbname ?? secret.database;

    if (!database) {
        throw new Error(`Database secret '${dbSecretArn}' missing dbname/database`);
    }

    const pool = new Pool({
        user: secret.username,
        password: secret.password,
        host: secret.host,
        port: Number(secret.port),
        database,
        ssl: process.env['STAGE'] === 'local' ? false : { rejectUnauthorized: false },
        max: 1,
    });

    const applied: string[] = [];
    const skipped: string[] = [];
    const client = await pool.connect();

    try {
        await client.query(
            'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );

        for (const name of MIGRATION_NAMES) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(name);
                continue;
            }

            const sql = readFileSync(join(migrationsDir, `${name}.sql`), 'utf8');
            await client.query('BEGIN');

            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
                await client.query('COMMIT');
                applied.push(name);
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${name} failed`, { cause: err });
            }
        }

        return { applied, skipped };
    } finally {
        client.release();
        await pool.end();
    }
};
