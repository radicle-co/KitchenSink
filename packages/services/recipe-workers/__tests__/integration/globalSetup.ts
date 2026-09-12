/**
 * Vitest global setup for the `@kitchensink/recipe-workers` integration tier.
 *
 * Runs ONCE per test run, before any suite: provisions this package's throwaway database under the
 * production role model (ADR-0039) and migrates it with recipe's migrations through the shared engine, so
 * every suite sees the schema a stage has — and sees it as `recipe_app`, the role the deployed Lambdas hold.
 *
 * A NO-OP when no admin server is configured, so a machine without PostgreSQL skips the DB work rather than
 * failing the run (the suites themselves `describe.skipIf(!hasTestDatabase)`). That is what keeps the tier
 * safe to invoke unconditionally from CI.
 *
 * @sideEffect Creates roles and a database on the admin server, and rebuilds its `public` schema.
 */
import { provisionRoleDatabase } from '@kitchensink/service-test-harness';

import { hasTestDatabase, recipeWorkersDbSpec } from './roleDb.js';

export async function setup(): Promise<void> {
    if (!hasTestDatabase) {
        return;
    }

    await provisionRoleDatabase(recipeWorkersDbSpec());
}
