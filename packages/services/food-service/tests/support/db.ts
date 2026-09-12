/**
 * Shared integration-test Drizzle bootstrap for the DB-backed suites.
 *
 * ⛔ This module does not know how to BUILD a schema, and exports no superuser URL. `tests/support/roleDb.ts`
 * owns the database (ADR-0039), `tests/globalSetup.ts` migrates it once per run with the service's OWN
 * production runner, and this module is only a Drizzle client over the SUBJECT's connection.
 *
 * {@link makePool} binds to `food_app`, the DML-only role the deployed service holds, so a privilege the
 * service does not have fails here instead of in a stage.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from '../../src/db/schema/index.js';

import { foodDb } from './roleDb.js';

/** The Drizzle client type used by every food-domain DAO (node-postgres driver + the food schema). */
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Build a Drizzle client over the given pool, bound to the food schema.
 *
 * @param pool - The connected pg pool.
 * @param logger - Optional Drizzle query logger. The ONE use for it is capturing the exact statement a
 *                 DAO sent so a suite can `EXPLAIN` it — asserting on a plan otherwise means restating the
 *                 SQL in the test, and a restated statement is a second representation that drifts from
 *                 the one production runs (see `drainClaimScaling.integration.test.ts`).
 * @returns A Drizzle client compatible with the DAO constructors.
 */
export function makeDb(pool: pg.Pool, logger?: DrizzleQueryLogger): TestDb {
    return logger === undefined ? drizzle(pool, { schema }) : drizzle(pool, { schema, logger });
}

/** The shape Drizzle's `logger` option accepts. */
export interface DrizzleQueryLogger {
    logQuery(query: string, params: unknown[]): void;
}

/**
 * Open a fresh pg pool for the integration database, AS THE SERVICE ROLE.
 *
 * ⛔ Resolved on each call rather than from a module-level constant: `foodDb()` reads `DATABASE_ADMIN_URL`
 * and throws when none is set, and a module-level read would turn "no PostgreSQL here" into an import
 * error for every suite that imports this file — including the ones that would have skipped.
 *
 * @returns A connected pool on `food_app` (caller must `end()` it).
 * @sideEffect Opens Postgres connections, and reads `DATABASE_ADMIN_URL`.
 */
export function makePool(): pg.Pool {
    return new pg.Pool({ connectionString: foodDb().appUrl });
}
