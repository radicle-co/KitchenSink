/**
 * SEED DOWNGRADED — write the downgraded owner's private recipe and collection, once, as the owner (plan
 * 2026-10-14-009 T2). Step 2 of the three in `poolAdmin.ts`: run it AFTER `poolAdmin --apply` made the lane premium and
 * BEFORE `poolAdmin --apply --settle-downgraded` takes the role away.
 *
 * ⛔ IT CREATES NO CLERK USER AND CHANGES NO ROLE. It signs in as the `roles` tier's `roledowngraded` slot, refuses to
 * write unless identity says that cook is entitled (a private recipe from anyone else is refused `400
 * INVALID_VISIBILITY`, which would read as an app defect), and reconciles the fixed world
 * (`planDowngradedOwnerWorld`). Running it twice changes nothing the second time.
 *
 * @sideEffect Signs one pool slot in, then reads, deletes and creates that cook's recipes and collections.
 */
import { remintFromSession } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { DOWNGRADED_OWNER_LANE_ID, slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { clientFor } from './client.js';
import { seedDowngradedOwnerWorld } from './downgradedOwnerWorld.js';
import { readIdentityOrigin, readSeedEnvironment } from './env.js';
import { assertSignerEntitled } from './signerEntitlement.js';
import { memoizingTokenSource } from './tokenSource.js';

const env = readSeedEnvironment(process.env);
const identityOrigin = readIdentityOrigin(process.env);
const slot = slotFor('roles', DOWNGRADED_OWNER_LANE_ID);

const { handle } = await leaseSession({
    slot,
    publishableKey: env.clerkPublishableKey,
    origin: env.webOrigin,
    port: clerkLeasePort(env.clerkSecretKey),
});
console.error(`e2e-seed seed-downgraded: signed in ${slot.email}`);

await assertSignerEntitled({
    identityOrigin,
    signerEmail: slot.email,
    token: memoizingTokenSource(handle, { remint: remintFromSession }),
});
console.error(`e2e-seed seed-downgraded: ${slot.email} is entitled, so its private rows will be accepted`);

const plan = await seedDowngradedOwnerWorld(clientFor(env.recipeOrigin, handle));

console.error(
    `e2e-seed seed-downgraded: recipe ${plan.createRecipe ? 'created' : 'kept'}, collection ` +
        `${plan.createCollection ? 'created' : 'kept'}, ${plan.deleteRecipeIds.length + plan.deleteCollectionIds.length} stale rows deleted. ` +
        'Now run: poolAdmin --apply --settle-downgraded',
);
