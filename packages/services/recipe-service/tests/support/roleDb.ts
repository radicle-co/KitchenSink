/**
 * The integration and e2e tiers' database, provisioned the way a stage provisions one (ADR-0039).
 *
 * ## ⛔ Why the suites no longer connect as `postgres`
 *
 * Every suite here opened its own pool on `DATABASE_URL` — a SUPERUSER — and the global setup applied the
 * schema by replaying the `.sql` files, skipping the advisory lock, the privilege statements, the ownership
 * audit and `expectManifestSha` (ADR-0035) that the real runner enforces. A superuser also satisfies every
 * grant, so a privilege the recipe service does NOT hold in production passed the whole tier and would have
 * failed only in a stage.
 *
 * Now: the production role model, the service's OWN runner as `recipe_migrator`, and one subject connection
 * — `recipe_app`, DML only. Fixture work that needs more is spelled `asOwner` at the call site.
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

/** The integration tier's throwaway database. */
export const RECIPE_TEST_DATABASE = 'recipe_test';

/**
 * The e2e tier's own throwaway database.
 *
 * ⛔ Separate from the integration tier's on purpose: both tiers rebuild the whole schema in their global
 * setup, so sharing one database makes a concurrent run of the two destroy the other's world — a cross-tier
 * flake that reads as a product bug. Food's fixture records the same decision.
 */
export const RECIPE_E2E_DATABASE = 'recipe_e2e_test';

/** The ordered hand-authored migrations — the set the deployed runner ships. */
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

/**
 * How a test database is built: recipe's roles, recipe's migrations, recipe's own production runner.
 *
 * @param database - Which throwaway database; defaults to the integration tier's.
 * @returns The spec, used by the global setups to provision and by {@link recipeDb} to connect.
 */
export function recipeDbSpec(database: string = RECIPE_TEST_DATABASE): RoleDatabaseSpec {
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

/**
 * The e2e tier's handle, on its own database.
 *
 * @returns The role-database handle.
 * @sideEffect Reads `DATABASE_ADMIN_URL` when a URL is read.
 */
export function recipeE2eDb(): RoleDatabase {
    return roleDatabase(recipeDbSpec(RECIPE_E2E_DATABASE));
}
