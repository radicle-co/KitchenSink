/**
 * Drizzle client proxy for `@kitchensink/recipe-service` (T015). Wraps a `pg.Pool` with the full recipe
 * schema so every table + inferred type is available on the client. Mirrors the food service's typed
 * `drizzle(pool, { schema })` client. The pool itself (RDS-IAM auth) is built in `pool-config.ts` and
 * provided by `database.module.ts`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';

import * as schema from './schema/index.js';

/** The full recipe schema object (every table + relation) passed to Drizzle. */
export type RecipeSchema = typeof schema;

/** The Drizzle client type exported by {@link DatabaseModule}, including the recipe schema. */
export type RecipeDrizzle = ReturnType<typeof drizzle<RecipeSchema>>;

/**
 * Build a schema-typed Drizzle client over an existing `pg.Pool`.
 *
 * @sideEffect none — wraps the pool; connections open lazily on first query.
 */
export function createRecipeDrizzle(pool: pg.Pool): RecipeDrizzle {
    return drizzle(pool, { schema });
}
