/**
 * `pg` pool configuration for the food logical database, shared by the API, both workers, and the
 * migrate lambda so they authenticate identically.
 *
 * Deployed stages authenticate the `food_app` role passwordlessly with short-lived RDS IAM tokens
 * (ADR-0006 / feature 003): there is no database password anywhere. `pg` invokes the `password` function
 * on every new pooled connection, so the ~15-minute IAM token TTL is refreshed transparently as the pool
 * opens or recycles connections — no manual rotation. Local dev (`STAGE=local`) keeps static-password
 * auth against docker Postgres.
 *
 * TLS is always on — RDS IAM auth *requires* it — but the Amazon RDS CA is not verified
 * (`rejectUnauthorized: false`): the connection is encrypted, and the server is a known RDS endpoint
 * reached inside the VPC (see database.module.ts for the full rationale).
 *
 * @implements FR-001
 */
import { Signer } from '@aws-sdk/rds-signer';
import type pg from 'pg';

/** Connection coordinates for the food database (host/port/name/user come from the environment). */
export interface FoodDbConnection {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
}

/** The `food_app` least-privilege role — the only DB principal the food workloads use. */
export const FOOD_DB_USERNAME = 'food_app';

const DEFAULT_REGION = 'us-east-1';

function region(): string {
    return process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? DEFAULT_REGION;
}

/**
 * Build a `pg` pool config from explicit connection coordinates. Deployed stages get an IAM-token
 * `password` provider; `STAGE=local` gets the static `DB_PASSWORD`.
 */
export function foodPoolConfig(connection: FoodDbConnection): pg.PoolConfig {
    const base: pg.PoolConfig = {
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
    };

    // Local docker Postgres speaks no TLS and has a static password — no SSL, no IAM.
    if (process.env['STAGE'] === 'local') {
        const password = process.env['DB_PASSWORD'];

        if (!password) {
            throw new Error('STAGE=local with the discrete DB_* config requires DB_PASSWORD (or use DATABASE_URL).');
        }

        return { ...base, ssl: false, password };
    }

    const signer = new Signer({
        hostname: connection.host,
        port: connection.port,
        username: connection.username,
        region: region(),
    });

    // pg calls this per new connection, so each fresh connection gets a valid (unexpired) token.
    return { ...base, ssl: { rejectUnauthorized: false }, password: (): Promise<string> => signer.getAuthToken() };
}

/**
 * Build a `pg` pool config from the standard food service environment. Prefers `DATABASE_URL` (local
 * dev), else the discrete `DB_*` parts with IAM auth as `food_app`.
 *
 * @throws {Error} when neither `DATABASE_URL` nor a complete `DB_HOST`/`DB_PORT`/`DB_NAME` set is present.
 */
export function foodPoolConfigFromEnv(): pg.PoolConfig {
    const url = process.env['DATABASE_URL'];

    if (url) {
        return { connectionString: url };
    }

    const host = process.env['DB_HOST'];
    const port = process.env['DB_PORT'];
    const database = process.env['DB_NAME'];

    if (!host || !port || !database) {
        throw new Error('Missing required database configuration. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME.');
    }

    // Fail fast on a malformed port — Number('abc'/'') → NaN, which would otherwise surface as a confusing
    // error deep inside pg/rds-signer at connect time.
    const portNumber = Number(port);

    if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) {
        throw new Error(`Invalid DB_PORT "${port}" — expected a TCP port (1-65535).`);
    }

    return foodPoolConfig({
        host,
        port: portNumber,
        database,
        username: process.env['DB_USERNAME'] ?? FOOD_DB_USERNAME,
    });
}
