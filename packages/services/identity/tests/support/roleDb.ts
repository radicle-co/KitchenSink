/**
 * The integration and e2e tiers' databases, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites do not connect as `postgres`
 *
 * A pool on `DATABASE_URL` — a SUPERUSER — satisfies every grant, and a per-suite "drop the schema and
 * replay the `.sql` files" is not the runner that migrates a real stage: it skips the advisory lock, the
 * privilege statements, the ownership audit and `expectManifestSha` (ADR-0035). Either lets a privilege the
 * identity service does NOT hold in production pass the tier and fail only in a stage.
 *
 * This module is the one declaration: identity's roles, identity's migrations, identity's own production
 * runner. `tests/globalSetup.ts` provisions once per run; each suite opens a pool on {@link identityDb}'s
 * `appUrl` — `identity_service`, DML only — and empties data between tests with `truncate()`, which runs as
 * the owner because the service role has no TRUNCATE.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';
import { roleDatabase, type RoleDatabase, type RoleDatabaseSpec } from '@kitchensink/service-test-harness';

import { runMigrations } from '../../src/lambdas/migrate/handler.js';

/**
 * The LOCAL e2e tier's throwaway database. Only that tier opens a database: the integration tier mocks it
 * (`docs/CODING_STANDARDS.md` §7.1a).
 */
export const IDENTITY_E2E_DATABASE = 'identity_e2e_test';

/** identity-service owns these files, and its own runner applies them. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

/**
 * How a test database is built. One declaration, used by the e2e tier's global setup to provision and by
 * {@link identityDb} to connect.
 *
 * @param database - Which throwaway database; defaults to the e2e tier's.
 * @returns The spec.
 */
export function identityDbSpec(database: string = IDENTITY_E2E_DATABASE): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.identity,
        database,
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
