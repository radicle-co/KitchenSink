/**
 * The integration tier's Postgres harness for `@kitchensink/identity-webhooks`.
 *
 * ONE authoritative representation of "where the identity schema comes from" and "how a spec opens a
 * handle on it", shared by `tests/global-setup.ts` (which applies the schema once per run) and every
 * `*.integration.test.ts` (which open a pool and reset rows between tests). Without this module each spec
 * would re-derive the migrations path and the reset statement — exactly the duplication that lets one
 * spec's idea of the schema drift from another's.
 *
 * The driver pair is deliberately `pg` + `drizzle-orm/node-postgres`, matching `src/common/db.ts`'s
 * production `Pool`, so the specs exercise the same driver behaviour (parameter binding, transaction
 * semantics) the Lambdas actually get at runtime.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/**
 * The harness connection string. Unset → the tier skips (see {@link hasDatabaseUrl}).
 *
 * MUST be a THROWAWAY database: {@link applyIdentitySchema} drops the `public` schema.
 */
export const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

/** Whether a test database is configured — specs guard with `describe.skipIf(!hasDatabaseUrl)`. */
export const hasDatabaseUrl = Boolean(DATABASE_URL);

/**
 * The identity schema's migration directory.
 *
 * identity-service OWNS these files; identity-webhooks reads them by FILESYSTEM PATH rather than importing
 * across the workspace boundary — the same arrangement `esbuild.mjs` already uses to copy them into
 * `dist/migrations/` for the `migrate` Lambda. Keeping the test tier on the same files means the schema
 * under test can never drift from the schema the migrate Lambda applies to RDS.
 */
const migrationsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'identity',
    'src',
    'database',
    'migrations',
);

/**
 * The tables the erasure path writes, ordered CHILD-FIRST so a plain `DELETE` sweep never trips a foreign
 * key. `lifecycle_events` is the append-only R8 audit, so it is reset too — otherwise a spec asserting "one
 * audit row was appended" would see the previous spec's rows.
 */
const RESETTABLE_TABLES = ['lifecycle_events', 'profiles', 'accounts', 'users'] as const;

/**
 * Reset `public` and apply identity-service's ordered migrations, exactly as the identity service's own
 * integration suite does (drop the schema, then each `.sql` in filename order).
 *
 * @param pool - A pool on the THROWAWAY test database.
 * @sideEffect DROPS the `public` schema on the connected database and executes all migration DDL.
 */
export async function applyIdentitySchema(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

/** A pool + the drizzle handle over it, as the erasure seams expect. */
export interface IntegrationDb {
    readonly pool: pg.Pool;
    readonly db: NodePgDatabase<Record<string, never>>;
}

/**
 * Open a pool + drizzle handle on the harness database.
 *
 * @returns The pool and its drizzle handle. Callers must `pool.end()` in `afterAll`.
 * @throws If `DATABASE_URL`/`TEST_DATABASE_URL` is unset — guard with `describe.skipIf(!hasDatabaseUrl)`.
 * @sideEffect Opens a Postgres connection pool.
 */
export function openIntegrationDb(): IntegrationDb {
    if (!hasDatabaseUrl) {
        throw new Error('openIntegrationDb requires DATABASE_URL (or TEST_DATABASE_URL). Is the harness up?');
    }

    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    return { pool, db: drizzle(pool) };
}

/**
 * Truncate every table the erasure path touches, so each test starts from an empty identity world.
 *
 * @param pool - The harness pool.
 * @sideEffect Deletes all rows from the identity tables.
 */
export async function resetIdentityRows(pool: pg.Pool): Promise<void> {
    await pool.query(RESETTABLE_TABLES.map((table) => `DELETE FROM ${table};`).join(' '));
}
