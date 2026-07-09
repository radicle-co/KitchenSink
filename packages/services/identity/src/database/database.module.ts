import { Module, Global } from '@nestjs/common';
import { users, accounts, profiles } from './schema/index.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

export const DrizzleProvider = 'DRIZZLE_CONNECTION';

function buildConnectionString(): string {
    if (process.env['DATABASE_URL']) {
        return process.env['DATABASE_URL'];
    }

    const host = process.env['DB_HOST'];
    const port = process.env['DB_PORT'];
    const database = process.env['DB_NAME'];
    const user = process.env['DB_USERNAME'];
    const password = process.env['DB_PASSWORD'];

    if (!host || !port || !database || !user || !password) {
        throw new Error(
            'Missing required database configuration. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD.',
        );
    }

    // `no-verify`, not `require`: RDS uses the Amazon RDS CA (absent from Node's trust store).
    // `pg-connection-string` maps `require` to `ssl: {}` → `rejectUnauthorized` defaults to `true`
    // → the RDS CA is rejected (`SELF_SIGNED_CERT_IN_CHAIN`) and every query 500s. `no-verify` maps
    // to `ssl: { rejectUnauthorized: false }`: still encrypted, verification skipped — fine for a
    // known RDS endpoint inside the VPC. (Food-service moved to passwordless RDS IAM auth, which also
    // requires this un-verified TLS; identity still uses password auth via the RDS master secret.)
    return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=no-verify`;
}

@Global()
@Module({
    providers: [
        {
            provide: DrizzleProvider,
            async useFactory() {
                const pool = new Pool({
                    connectionString: buildConnectionString(),
                    max: 20,
                    idleTimeoutMillis: 30_000,
                    connectionTimeoutMillis: 5_000,
                });

                return drizzle(pool, { schema: { users, accounts, profiles } });
            },
        },
    ],
    exports: [DrizzleProvider],
})
export class DatabaseModule {}
