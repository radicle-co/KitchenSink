/**
 * `pg` pool configuration for the recipe logical database (`kitchensink_recipes`) on the shared RDS
 * instance. Mirrors the shipped food service (`packages/services/food-service/src/database/poolConfig.ts`):
 * deployed stages authenticate the passwordless `recipe_app` role with short-lived RDS IAM tokens — no
 * database password anywhere. `pg` invokes the `password` provider on every new pooled connection, so
 * the ~15-minute token TTL is refreshed transparently as the pool opens/recycles connections.
 *
 * `STAGE=local` keeps static-password auth against docker Postgres. TLS is always on in deployed stages
 * (RDS IAM auth requires it) but the Amazon RDS CA is not verified (`rejectUnauthorized: false`): the
 * connection is encrypted and the endpoint is a known RDS host reached inside the VPC.
 *
 * Connection wiring is finalized with infra (RecipeDbBootstrap custom resource); this module defines the
 * pool contract the DatabaseModule provider depends on.
 */
import { Signer } from '@aws-sdk/rds-signer';
import type pg from 'pg';

/** Connection coordinates for the recipe database (host/port/name/user come from the environment). */
export interface RecipeDbConnection {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
}

/** The recipe service's logical database on the shared RDS instance. */
export const RECIPE_DB_NAME = 'kitchensink_recipes';

/** The `recipe_app` least-privilege role — the only DB principal the recipe workloads use (RDS-IAM). */
export const RECIPE_DB_USERNAME = 'recipe_app';

const DEFAULT_REGION = 'us-east-1';

function region(): string {
    return process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? DEFAULT_REGION;
}

/**
 * Build a `pg` pool config from explicit connection coordinates. Deployed stages get an IAM-token
 * `password` provider; `STAGE=local` gets the static `DB_PASSWORD`.
 */
export function recipePoolConfig(connection: RecipeDbConnection): pg.PoolConfig {
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
 * Build a `pg` pool config from the standard recipe service environment. Prefers `DATABASE_URL` (local
 * dev), else the discrete `DB_*` parts with IAM auth as `recipe_app`.
 *
 * @throws {Error} when neither `DATABASE_URL` nor a complete `DB_HOST`/`DB_PORT`/`DB_NAME` set is present.
 */
export function recipePoolConfigFromEnv(): pg.PoolConfig {
    const url = process.env['DATABASE_URL'];

    if (url) {
        return { connectionString: url };
    }

    const host = process.env['DB_HOST'];
    const port = process.env['DB_PORT'];
    const database = process.env['DB_NAME'] ?? RECIPE_DB_NAME;

    if (!host || !port) {
        throw new Error('Missing required database configuration. Provide DATABASE_URL or DB_HOST, DB_PORT, DB_NAME.');
    }

    // Fail fast on a malformed port — Number('abc'/'') → NaN, which would otherwise surface as a confusing
    // error deep inside pg/rds-signer at connect time.
    const portNumber = Number(port);

    if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) {
        throw new Error(`Invalid DB_PORT "${port}" — expected a TCP port (1-65535).`);
    }

    return recipePoolConfig({
        host,
        port: portNumber,
        database,
        username: process.env['DB_USERNAME'] ?? RECIPE_DB_USERNAME,
    });
}
