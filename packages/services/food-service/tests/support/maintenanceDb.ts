/**
 * Bootstrap for the SHARED BASE food database in the integration Postgres (U38).
 *
 * A per-PR food database is no longer created empty — it is cloned from the seeded base with
 * `CREATE DATABASE … TEMPLATE "kitchensink_food"`, so the integration tier needs a real base database to
 * clone, exactly as a deployed stage has one (created by `DataStack`'s bootstrap custom resource and
 * seeded once from the USDA bulk download).
 *
 * ⚠️ The base is a DIFFERENT database from the tier's own `food_test`. That separation is not incidental:
 * PostgreSQL refuses to copy a database that any session is connected to, so a harness that pointed the
 * suites' pool at the template would make every clone fail. Maintenance statements (`CREATE DATABASE`) go
 * through the `postgres` database, which is what the deployed migration runner does too.
 *
 * ⚠️ `kitchensink_food` is the ONE name in this package's tests that keeps the `kitchensink_` prefix the
 * per-PR reaper's census counts: it is a PRODUCTION constant, quoted verbatim into the `TEMPLATE` clause
 * the runner under test emits, and `FOOD_DATABASE_NAME_PATTERN` refuses anything else.
 */
import pg from 'pg';

import { DATABASE_ROLES, readMigrationManifest } from '@kitchensink/db-schema-guard';
import {
    assertDatabaseOwnedBy,
    provisionRdsLikeDatabase,
    type RdsLikeDatabase,
} from '@kitchensink/service-test-harness';

import { BASE_FOOD_DATABASE_NAME, runMigrations } from '../../src/lambdas/migrate/handler.js';
import { migrationsDir } from './roleDb.js';

/** The marker row seeded into the base catalog, so a clone can be proven to arrive WARM, not merely present. */
export const BASE_MARKER_FOOD = {
    id: 'u38-base-marker',
    normalizedName: 'u38 base marker',
} as const;

/**
 * Create the base `kitchensink_food` database if absent, migrate it, and seed one marker food row.
 * Idempotent, and leaves NO open session on the base (a lingering one would block every clone).
 *
 * @returns The base's connection strings, for each principal.
 * @throws {MisownedDatabaseError} when a pre-role-split base is in the way.
 * @sideEffect Connects to PostgreSQL and may execute `CREATE DATABASE` and DML.
 */
export async function ensureSeededBaseDatabase(): Promise<RdsLikeDatabase> {
    // The production role model, applied by a NOSUPERUSER stand-in for the RDS master. `createDatabase`
    // is idempotent, so this both creates the base and gives us the master's connection to inspect it.
    const provisioned = await provisionRdsLikeDatabase({
        roles: DATABASE_ROLES.food,
        database: BASE_FOOD_DATABASE_NAME,
    });
    // ⛔ REPORTED, never repaired — the harness owns that rule, and the reason, once.
    await assertDatabaseOwnedBy(provisioned.masterUrl, BASE_FOOD_DATABASE_NAME, DATABASE_ROLES.food.owner);

    const basePool = new pg.Pool({ connectionString: provisioned.migratorUrl, max: 1 });

    try {
        // The production runner, as the production MIGRATOR — so the base is migrated the way a stage is.
        // The digest is of the very directory this call migrates: `expectManifestSha` is REQUIRED
        // (ADR-0035), so passing it makes this exercise the contract the deployed runner enforces rather
        // than a laxer one that only exists in the test.
        await runMigrations({
            pool: basePool,
            migrationsDir,
            expectManifestSha: readMigrationManifest(migrationsDir).sha,
            database: BASE_FOOD_DATABASE_NAME,
        });
    } finally {
        // ⛔ Not optional. An idle pooled client counts as a session on the template and PostgreSQL would
        // refuse every subsequent clone with SQLSTATE 55006.
        await basePool.end();
    }

    // The marker is written as the SERVICE role: DML only, which is all a seed ever needs.
    const appPool = new pg.Pool({ connectionString: provisioned.appUrl, max: 1 });

    try {
        await appPool.query(
            'INSERT INTO food (id, normalized_name, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
            [BASE_MARKER_FOOD.id, BASE_MARKER_FOOD.normalizedName, 'RESOLVED'],
        );
    } finally {
        await appPool.end();
    }

    return provisioned;
}
