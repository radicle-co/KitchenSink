/**
 * The integration tier's Postgres harness for `@kitchensink/identity-webhooks`.
 *
 * ONE authoritative representation of "where the identity schema comes from" and "how a spec opens a
 * handle on it", shared by `tests/globalSetup.ts` (which provisions and migrates once per run) and every
 * `*.integration.test.ts` (which open a pool and reset rows between tests).
 *
 * ## ⛔ The subject is `identity_service`, never a superuser
 *
 * These specs used to connect as `postgres` and apply the schema by replaying the `.sql` files themselves —
 * a fifth copy of the migration runner, and a subject that could do anything. Under the role split
 * (ADR-0039) the deployed webhook Lambdas hold DML and nothing else, so the tier now provisions the
 * production role model and hands the specs the SERVICE role: a privilege these handlers do not have in a
 * stage now fails here. Fixture work that legitimately needs more (the erasure suite's constraint probe)
 * goes through `identityDb().asOwner`, named at the call site.
 *
 * The schema is migrated by identity-service's OWN engine over its migration directory, read by FILESYSTEM
 * PATH — the same arrangement `esbuild.mjs` uses to copy them into `dist/migrations/` — because a deployable
 * exports only its handlers, and importing across that boundary is what `src/common/db.ts` refuses.
 *
 * The driver pair is deliberately `pg` + `drizzle-orm/node-postgres`, matching `src/common/db.ts`'s
 * production `Pool`, so the specs exercise the same driver behaviour the Lambdas get at runtime.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    engineMigrator,
    hasAdminServer,
    roleDatabase,
    type RoleDatabase,
    type RoleDatabaseSpec,
} from '@kitchensink/service-test-harness';

/** Whether an admin server is configured — specs guard with `describe.skipIf(!hasTestDatabase)`. */
export const hasTestDatabase = hasAdminServer;

/** This package's throwaway database. */
export const IDENTITY_WEBHOOKS_TEST_DATABASE = 'identity_webhooks_test';

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
 * How this package's test database is built: identity's roles, identity's migrations, identity's engine.
 * One declaration, used by `tests/globalSetup.ts` to provision and by {@link identityDb} to connect.
 *
 * @returns The spec.
 */
export function identityDbSpec(): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.identity,
        database: IDENTITY_WEBHOOKS_TEST_DATABASE,
        migrationsDir,
        // The tables THESE handlers read — a contract with identity's schema, not a copy of it: asserting
        // identity's whole shape is identity's own runner suite's job.
        migrate: engineMigrator({
            label: 'identity (for identity-webhooks)',
            roles: DATABASE_ROLES.identity,
            expectedTables: [...RESETTABLE_TABLES],
        }),
    };
}

/**
 * The handle for this package's test database: the service role for the subject, and `asOwner` for fixture
 * work that needs the owner. Pure — `tests/globalSetup.ts` does the provisioning once per run.
 *
 * @returns The role-database handle.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function identityDb(): RoleDatabase {
    return roleDatabase(identityDbSpec());
}

/** A pool + the drizzle handle over it, as the erasure seams expect. */
export interface IntegrationDb {
    readonly pool: pg.Pool;
    readonly db: NodePgDatabase<Record<string, never>>;
}

/**
 * Open a pool + drizzle handle on the harness database.
 *
 * @returns The pool and its drizzle handle, as the SERVICE role. Callers must `pool.end()` in `afterAll`.
 * @throws {NonDisposableAdminServerError} when no admin server is configured — guard with
 *   `describe.skipIf(!hasTestDatabase)`.
 * @sideEffect Opens a Postgres connection pool.
 */
export function openIntegrationDb(): IntegrationDb {
    const pool = new pg.Pool({ connectionString: identityDb().appUrl });

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
