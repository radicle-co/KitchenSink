/**
 * Vitest global setup for the food service's E2E tier.
 *
 * Provisions the E2E tier's own throwaway database under the production role model (ADR-0039) and migrates
 * it with the service's OWN runner, ONCE per run. The booted app then connects as `food_app`.
 *
 * A NO-OP when no admin server is configured, so a machine without PostgreSQL skips rather than fails — the
 * suites themselves `describe.skipIf(!hasTestDatabase)`.
 *
 * @sideEffect Creates roles and a database on the admin server, and rebuilds its `public` schema.
 */
import { provisionRoleDatabase } from '@kitchensink/service-test-harness';

import { FOOD_E2E_DATABASE, foodDbSpec, hasTestDatabase } from '../support/roleDb.js';

export async function setup(): Promise<void> {
    if (!hasTestDatabase) {
        return;
    }

    await provisionRoleDatabase(foodDbSpec(FOOD_E2E_DATABASE));
}
