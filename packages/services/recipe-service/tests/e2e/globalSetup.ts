/**
 * Vitest global setup for the recipe service's E2E tier.
 *
 * The same harness preparation the integration tier runs — LocalStack buckets and queues, the role-split
 * database, the seeded world — but on the e2e tier's OWN database (`recipe_e2e_test`).
 *
 * ⛔ Its own database, not the integration tier's: both setups rebuild the whole schema, so sharing one
 * makes a concurrent run of the two tiers destroy the other's world, which surfaces as a flake that reads
 * like a product bug rather than a harness collision.
 *
 * @sideEffect Network + database I/O; rebuilds `public` on the e2e database.
 */
import { prepareHarness } from '../globalSetup.js';
import { RECIPE_E2E_DATABASE, recipeDbSpec } from '../support/roleDb.js';

export async function setup(): Promise<void> {
    await prepareHarness(recipeDbSpec(RECIPE_E2E_DATABASE));
}

export { teardown } from '../globalSetup.js';
