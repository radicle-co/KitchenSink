/**
 * Vitest global setup for the food service's E2E tier.
 *
 * Provisions the E2E tier's own throwaway database under the production role model (ADR-0039) and migrates
 * it with the service's OWN runner, ONCE per run. The booted app then connects as `food_app`.
 *
 * ⛔ LOCAL e2e never skips (`docs/CODING_STANDARDS.md` §7.1a): with no `DATABASE_ADMIN_URL` the provisioning throws,
 * so the run fails before any suite instead of reporting a green tier that never ran.
 *
 * @sideEffect Creates roles and a database on the admin server, and rebuilds its `public` schema.
 */
import { provisionRoleDatabase } from '@kitchensink/service-test-harness';

import { FOOD_E2E_DATABASE, foodDbSpec } from '../support/roleDb.js';

export async function setup(): Promise<void> {
    await provisionRoleDatabase(foodDbSpec(FOOD_E2E_DATABASE));
}
