import { Signer } from '@aws-sdk/rds-signer';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { requireEnv } from './config.js';

/**
 * Passwordless connection to this stage's recipe logical database on the shared RDS instance — the base
 * `kitchensink_recipes` on a base stage, or the preview's own `kitchensink_recipes_pr_{N}` (ADR-0006). Which
 * one is NOT decided here: `RECIPE_DB_NAME` is set by `RecipeWorkersStack`, which derives it from the same
 * `recipeDatabaseNameForStage` authority the recipe service uses, and is required rather than defaulted.
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
    // REQUIRED, never defaulted (#119). A default here reads as harmless but is the second copy of the
    // footgun that pointed all six workers at the SHARED `kitchensink_recipes` while the API used the
    // preview's own `kitchensink_recipes_pr_73` — with three destructive scheduled sweepers among them.
    // Which database a worker mutates is not a value with a sensible fallback: unset must stop the worker.
    const database = requireEnv('RECIPE_DB_NAME');
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
