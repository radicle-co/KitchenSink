/**
 * Shared integration-test DB bootstrap for the `src/foods/dao/*` DAO suites (feature 003, Phase 1).
 *
 * Reuses the pattern from `tests/schema.integration.test.ts`: apply the hand-authored ordered
 * migration in `src/db/migrations/` to a clean `public` schema, then exercise the DAOs through a
 * Drizzle client over the same `pg` pool. The integration suite shares one database and runs
 * serially (`vitest.integration.config.ts` → `fileParallelism: false`), so each suite resets the
 * schema in `beforeAll`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from '../../src/db/schema/index.js';

/** Connection string for the integration Postgres (set by `npm run test:integration`). */
export const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** The Drizzle client type used by every food-domain DAO (node-postgres driver + the food schema). */
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/db/migrations');

/**
 * Drop and recreate the `public` schema, then apply every ordered `.sql` migration to it.
 *
 * @param pool - The connected pg pool.
 * @sideEffect Destroys all data in `public` and re-applies the source-of-truth DDL.
 */
export async function resetSchema(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

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
 * Open a fresh pg pool for the integration database.
 *
 * @returns A connected pool (caller must `end()` it).
 * @sideEffect Opens Postgres connections.
 */
export function makePool(): pg.Pool {
    return new pg.Pool({ connectionString: DATABASE_URL });
}
