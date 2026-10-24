/**
 * The integration and e2e tiers' database, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites do not connect as `postgres`
 *
 * A pool on `DATABASE_URL` — a SUPERUSER — satisfies every grant, and replaying the `.sql` files skips the
 * advisory lock, the privilege statements, the ownership audit and `expectManifestSha` (ADR-0035) that the
 * real runner enforces. Either lets a privilege the recipe service does NOT hold in production pass the
 * whole tier and fail only in a stage.
 *
 * So: the production role model, the service's OWN runner as `recipe_migrator`, and one subject connection
 * — `recipe_app`, DML only. Fixture work that needs more is spelled `asOwner` at the call site.
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
export const RECIPE_E2E_DATABASE = 'recipe_e2e_test';

/** The ordered hand-authored migrations — the set the deployed runner ships. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

/**
 * How a test database is built: recipe's roles, recipe's migrations, recipe's own production runner.
 *
 * @param database - Which throwaway database; defaults to the e2e tier's.
 * @returns The spec, used by the e2e global setup to provision and by {@link recipeDb} to connect.
 */
export function recipeDbSpec(database: string = RECIPE_E2E_DATABASE): RoleDatabaseSpec {
    return {
        roles: DATABASE_ROLES.recipe,
        database,
        migrationsDir,
        migrate: async ({ pool, migrationsDir: dir, expectManifestSha, database }) => {
            await runMigrations({ pool, migrationsDir: dir, expectManifestSha, database });
        },
    };
}

/**
 * The handle: `appUrl` for the subject, `asOwner` for fixture work the service role cannot do.
 *
 * @returns The role-database handle.
 * @sideEffect Reads `DATABASE_ADMIN_URL`.
 */
export function recipeDb(): RoleDatabase {
    return roleDatabase(recipeDbSpec());
}
