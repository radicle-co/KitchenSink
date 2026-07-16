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
 * **Schema-less by design, not by omission.** The handle is `NodePgDatabase<Record<string, never>>` — no
 * Drizzle schema is passed — and every handler issues raw `sql\`…\`` statements rather than relational
 * queries. That is deliberate: the `kitchensink_recipes` Drizzle models live inside `recipe-service`'s
 * `src` (not a shared package), and importing them here would couple these Lambdas to that service's
 * internals — the exact coupling the raw-SQL boundary avoids. Passing a schema would buy typed relational
 * queries that no handler uses, so it is a genuine no-op until a SHARED recipe-schema package exists AND a
 * handler actually needs a relational query. Neither is true today; when both are, add `{ schema, casing }`
 * here and the seam is ready for it.
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
