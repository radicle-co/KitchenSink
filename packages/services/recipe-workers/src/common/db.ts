import { Signer } from '@aws-sdk/rds-signer';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { requireEnv } from './config.js';

/**
 * Passwordless connection to the shared RDS instance's `kitchensink_recipes` logical database.
 *
 * Auth is RDS-IAM: the `recipe_app` role has no password secret — instead each new pooled
 * connection mints a short-lived IAM auth token (~15 min TTL) via `@aws-sdk/rds-signer`, passed as
 * the pg password. TLS is mandatory for IAM auth. The pool + drizzle instance are cached across
 * warm invocations (module scope) so a container reuses one pool.
 *
 * TODO(Phase 4+): pass the recipe Drizzle schema into `drizzle(pool, { schema, casing })` once the
 * `kitchensink_recipes` schema package exists, so callers get typed relational queries.
 */

const DEFAULT_DB_PORT = 5432;
const DEFAULT_DB_NAME = 'kitchensink_recipes';
const DEFAULT_DB_USER = 'recipe_app';
const DEFAULT_POOL_MAX = 5;

let pool: Pool | null = null;
let dbInstance: NodePgDatabase<Record<string, never>> | null = null;

/**
 * Resolve (and cache) the recipe database handle, authenticating with a freshly-signed RDS-IAM
 * token on each new physical connection.
 *
 * @sideEffect opens a pooled TLS connection to RDS on first call.
 */
export const getRecipeDb = (): NodePgDatabase<Record<string, never>> => {
    if (dbInstance) {
        return dbInstance;
    }

    const host = requireEnv('RECIPE_DB_HOST');
    const port = Number(process.env['RECIPE_DB_PORT'] ?? String(DEFAULT_DB_PORT));
    const database = process.env['RECIPE_DB_NAME'] ?? DEFAULT_DB_NAME;
    const user = process.env['RECIPE_DB_USER'] ?? DEFAULT_DB_USER;
    const region = requireEnv('AWS_REGION');

    const signer = new Signer({ hostname: host, port, username: user, region });

    pool = new Pool({
        host,
        port,
        database,
        user,
        // A function password is re-invoked by pg for every new physical connection, so each gets a
        // fresh IAM token rather than reusing an expired one.
        password: (): Promise<string> => signer.getAuthToken(),
        ssl: { rejectUnauthorized: false },
        max: Number(process.env['RECIPE_DB_POOL_MAX'] ?? String(DEFAULT_POOL_MAX)),
    });

    dbInstance = drizzle(pool);

    return dbInstance;
};
