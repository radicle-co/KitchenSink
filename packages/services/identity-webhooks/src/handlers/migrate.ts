import { Pool } from 'pg';

import sql0004 from '@kitchensink/identity-service/database/migrations/0004_users_sub_pk.sql';
import sql0005 from '@kitchensink/identity-service/database/migrations/0005_identity_reset.sql';
import sql0006 from '@kitchensink/identity-service/database/migrations/0006_webhook_idempotency.sql';
import sql0007 from '@kitchensink/identity-service/database/migrations/0007_webhook_events_ttl.sql';

import { requireEnv } from '../common/config.js';
import { getJsonSecret } from '../common/secrets.js';

// Ordered raw-SQL migrations (this project applies plain .sql, not drizzle-kit's journal). Each runs
// once, tracked in `schema_migrations`, so re-invoking is a no-op and the destructive reset in 0005
// never re-runs. Keep this list in sync with identity-service/src/database/migrations/*.sql.
const MIGRATIONS = [
    { name: '0004_users_sub_pk', sql: sql0004 },
    { name: '0005_identity_reset', sql: sql0005 },
    { name: '0006_webhook_idempotency', sql: sql0006 },
    { name: '0007_webhook_events_ttl', sql: sql0007 },
] as const;

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

        for (const migration of MIGRATIONS) {
            const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);

            if ((existing.rowCount ?? 0) > 0) {
                skipped.push(migration.name);
                continue;
            }

            await client.query('BEGIN');

            try {
                await client.query(migration.sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
                await client.query('COMMIT');
                applied.push(migration.name);
            } catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`);
            }
        }

        return { applied, skipped };
    } finally {
        client.release();
        await pool.end();
    }
};
