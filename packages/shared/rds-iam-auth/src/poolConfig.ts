/**
 * `pg` pool configuration for a database on the shared RDS instance, authenticated by RDS IAM.
 *
 * ## Why one package
 *
 * The same RDS-IAM wiring — a `@aws-sdk/rds-signer` `Signer`, a `password` FUNCTION, TLS, a `STAGE=local`
 * static-password escape hatch — had been written four times (food, recipe, recipe-service config, recipe-workers)
 * and the database role split (`docs/plans/2026-09-11-database-role-split.md`) is about to add identity and its
 * webhooks, which would make six. It is one piece of knowledge — how a workload in this repository opens an
 * IAM-authenticated connection — so it lives once. Service names, database names and role names are NOT known
 * here: every caller passes its own.
 *
 * DESIGN PATTERN: Adapter over `@aws-sdk/rds-signer`, exposing `pg`'s own `PoolConfig` shape.
 */
import { Signer } from '@aws-sdk/rds-signer';
import type pg from 'pg';

/** Where to connect, and as whom. */
export interface RdsConnection {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
}

/** The environment this module reads — `process.env` by default, a literal in tests. */
export type RdsEnv = Readonly<Record<string, string | undefined>>;

const DEFAULT_REGION = 'us-east-1';

/**
 * Build a `pg` pool config for explicit coordinates.
 *
 * Deployed stages get a `password` FUNCTION: `pg` calls it for every new physical connection, so each connection
 * gets a fresh (~15-minute) IAM token and a warm pool that outlives one token keeps reconnecting — a string would
 * be one token for the pool's whole life. TLS is on because RDS IAM authentication requires it; the RDS CA is not
 * in Node's trust store, so it encrypts without verifying (in-VPC, known endpoint).
 *
 * `STAGE=local` keeps static-password auth against docker Postgres, with no TLS and no IAM.
 *
 * @param connection - Host, port, database and login role.
 * @param env - Reads `STAGE`, `DB_PASSWORD`, `AWS_REGION`, `AWS_DEFAULT_REGION`.
 * @returns The pool config. Pure apart from constructing the signer (no I/O until `password()` is called).
 * @throws {Error} on `STAGE=local` without `DB_PASSWORD`.
 */
export function rdsPoolConfig(connection: RdsConnection, env: RdsEnv = process.env): pg.PoolConfig {
    const base: pg.PoolConfig = {
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.username,
    };

    if (env['STAGE'] === 'local') {
        const password = env['DB_PASSWORD'];

        if (!password) {
            throw new Error('STAGE=local with the discrete DB_* config requires DB_PASSWORD (or use DATABASE_URL).');
        }

        return { ...base, ssl: false, password };
    }

    const signer = new Signer({
        hostname: connection.host,
        port: connection.port,
        username: connection.username,
        region: env['AWS_REGION'] ?? env['AWS_DEFAULT_REGION'] ?? DEFAULT_REGION,
    });

    return { ...base, ssl: { rejectUnauthorized: false }, password: (): Promise<string> => signer.getAuthToken() };
}

/** The per-service defaults {@link rdsPoolConfigFromEnv} falls back to. */
export interface RdsEnvDefaults {
    /** The login role when `DB_USERNAME` is unset. */
    readonly username: string;
    /** The database when `DB_NAME` is unset. Omit to make `DB_NAME` required. */
    readonly database?: string;
}

/**
 * Parse a TCP port, failing fast on a malformed one — `Number('abc')` is `NaN`, which would otherwise surface as a
 * confusing error deep inside `pg` or the signer at connect time.
 *
 * @param value - The raw value.
 * @param name - The variable it came from, for the error.
 * @returns The port. Pure.
 * @throws {Error} when the value is not an integer in 1-65535.
 */
function parsePort(value: string, name: string): number {
    const port = Number(value);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid ${name} "${value}" — expected a TCP port (1-65535).`);
    }

    return port;
}

/**
 * Build a `pg` pool config from the standard `DB_*` environment.
 *
 * `DATABASE_URL` wins when set (local dev, and the integration tiers). Otherwise `DB_HOST` and `DB_PORT` are
 * required, `DB_NAME` falls back to `defaults.database` (required when there is none), and `DB_USERNAME` falls back
 * to `defaults.username` — which is how a migrate runner and a service in the same package connect as different
 * roles to the same database.
 *
 * @param defaults - The caller's own username and, optionally, database.
 * @param env - Defaults to `process.env`.
 * @returns The pool config.
 * @throws {Error} naming whichever required variable is missing or malformed.
 */
export function rdsPoolConfigFromEnv(defaults: RdsEnvDefaults, env: RdsEnv = process.env): pg.PoolConfig {
    const url = env['DATABASE_URL'];

    if (url) {
        return { connectionString: url };
    }

    const host = env['DB_HOST'];
    const port = env['DB_PORT'];
    const database = env['DB_NAME'] ?? defaults.database;
    const missing = [!host && 'DB_HOST', !port && 'DB_PORT', !database && 'DB_NAME'].filter(Boolean);

    if (!host || !port || !database) {
        throw new Error(
            `Missing required database configuration (${missing.join(', ')}). Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME.`,
        );
    }

    return rdsPoolConfig(
        { host, port: parsePort(port, 'DB_PORT'), database, username: env['DB_USERNAME'] ?? defaults.username },
        env,
    );
}
