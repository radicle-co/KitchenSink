/**
 * The integration tier's database, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites no longer connect as `postgres`
 *
 * Every suite here used to open its own pool on `DATABASE_URL` — a SUPERUSER — and carry its own copy of
 * "drop the schema and replay the `.sql` files". Three copies existed, and none of them was the runner that
 * migrates a real stage: they skipped the advisory lock, the privilege statements, the ownership audit and
 * `expectManifestSha` (ADR-0035). A superuser also satisfies every grant, so a privilege the identity
 * service does NOT hold in production passed the tier and failed only in a stage.
 *
 * This module is the one declaration: identity's roles, identity's migrations, identity's own production
 * runner. `tests/globalSetup.ts` provisions once per run; each suite opens a pool on {@link identityDb}'s
 * `appUrl` — `identity_service`, DML only — and empties data between tests with `truncate()`, which runs as
 * the owner because the service role has no TRUNCATE.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import {
    hasAdminServer,
    roleDatabase,
    type RoleDatabase,
    type RoleDatabaseSpec,
} from '@kitchensink/service-test-harness';

import { runMigrations } from '../../src/lambdas/migrate/handler.js';

/** Whether an admin server is configured — suites guard with `describe.skipIf(!hasTestDatabase)`. */
export const hasTestDatabase = hasAdminServer;

/** This package's throwaway database. */
export const IDENTITY_TEST_DATABASE = 'identity_test';

/** identity-service owns these files, and its own runner applies them. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

/**
 * How the test database is built. One declaration, used by `tests/globalSetup.ts` to provision and by
 * {@link identityDb} to connect.
 *
 * @returns The spec.
 */
export function identityDbSpec(): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.identity,
        database: IDENTITY_TEST_DATABASE,
        migrationsDir,
        // The PRODUCTION runner: the lock, the privilege statements, the ownership audit and the manifest
        // expectation are the parts a hand-rolled replay skipped.
        migrate: async ({ pool, migrationsDir: dir, expectManifestSha, database }) => {
            await runMigrations({ pool, migrationsDir: dir, expectManifestSha, database });
        },
    };
}

/**
 * The handle: `appUrl` for the subject, `asOwner` for fixture work that needs the owner.
 *
 * @returns The role-database handle.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function identityDb(): RoleDatabase {
    return roleDatabase(identityDbSpec());
}
