/**
 * Bootstrap for the SHARED BASE food database in the integration Postgres (U38).
 *
 * A per-PR food database is no longer created empty — it is cloned from the seeded base with
 * `CREATE DATABASE … TEMPLATE "kitchensink_food"`, so the integration tier needs a real base database to
 * clone, exactly as a deployed stage has one (created by `DataStack`'s bootstrap custom resource and
 * seeded once from the USDA bulk download).
 *
 * ⚠️ The base is a DIFFERENT database from `DATABASE_URL`'s. That separation is not incidental: PostgreSQL
 * refuses to copy a database that any session is connected to, so a harness that pointed the suite's own
 * pool at the template would make every clone fail. Maintenance statements (`CREATE`/`DROP DATABASE`) go
 * through the `postgres` database, which is what the deployed migration runner does too.
 */
import pg from 'pg';

import { BASE_FOOD_DATABASE_NAME, runMigrations } from '../../src/lambdas/migrate/handler.js';
import { DATABASE_URL, migrationsDir } from './db.js';

// The digest of the very directory each call migrates. `expectManifestSha` is REQUIRED (ADR-0035), so
// passing it here is not ceremony: it makes these tests exercise the contract the deployed runner enforces
// rather than a laxer one that only exists in the test.
import { readMigrationManifest } from '@kitchensink/db-schema-guard';

/** The marker row seeded into the base catalog, so a clone can be proven to arrive WARM, not merely present. */
export const BASE_MARKER_FOOD = {
    id: 'u38-base-marker',
    normalizedName: 'u38 base marker',
} as const;

/**
 * A connection string for `database` on the same server as `DATABASE_URL`.
 *
 * @param database - The database name to target.
 * @returns The rewritten connection string.
 */
export function connectionStringFor(database: string): string {
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${database}`;

    return url.toString();
}

/** A pool on the `postgres` maintenance database — never on the template, which must stay session-free. */
export function makeMaintenancePool(): pg.Pool {
    return new pg.Pool({ connectionString: connectionStringFor('postgres'), max: 1 });
}

/**
 * Create the base `kitchensink_food` database if absent, migrate it, and seed one marker food row.
 * Idempotent, and leaves NO open session on the base (a lingering one would block every clone).
 *
 * @sideEffect Connects to PostgreSQL and may execute `CREATE DATABASE` and DML.
 */
export async function ensureSeededBaseDatabase(): Promise<void> {
    const maintenancePool = makeMaintenancePool();

    try {
        const existing = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
            BASE_FOOD_DATABASE_NAME,
        ]);

        if ((existing.rowCount ?? 0) === 0) {
            await maintenancePool.query(`CREATE DATABASE "${BASE_FOOD_DATABASE_NAME}"`);
        }
    } finally {
        await maintenancePool.end();
    }

    const basePool = new pg.Pool({ connectionString: connectionStringFor(BASE_FOOD_DATABASE_NAME), max: 1 });

    try {
        // The production runner, not a restatement of it — so the base is migrated the way a stage is.
        await runMigrations({
            pool: basePool,
            migrationsDir,
            expectManifestSha: readMigrationManifest(migrationsDir).sha,
        });
        await basePool.query(
            'INSERT INTO food (id, normalized_name, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            [BASE_MARKER_FOOD.id, BASE_MARKER_FOOD.normalizedName, 'RESOLVED'],
        );
    } finally {
        // ⛔ Not optional. An idle pooled client counts as a session on the template and PostgreSQL would
        // refuse every subsequent clone with SQLSTATE 55006.
        await basePool.end();
    }
}
