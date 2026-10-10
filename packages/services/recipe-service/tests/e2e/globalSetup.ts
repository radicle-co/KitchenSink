/**
 * Vitest global setup for the recipe service's LOCAL e2e tier: the harness (`../support/localHarness.ts`) on the
 * tier's database (`recipe_e2e_test`), LocalStack buckets and queues, and the seeded world.
 *
 * @sideEffect Network + database I/O; rebuilds `public` on the e2e database.
 */
import { prepareHarness } from '../support/localHarness.js';
import { recipeDbSpec } from '../support/roleDb.js';

export async function setup(): Promise<void> {
    await prepareHarness(recipeDbSpec());
}
