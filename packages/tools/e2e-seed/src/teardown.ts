/**
 * TEARDOWN — reclaim everything this run created.
 *
 * Two halves, in order: the DATA (through the API, as its owner) and then the IDENTITIES (through Clerk).
 * Data first, because deleting the Clerk user first would revoke the session the data deletion needs.
 *
 * ⛔ It runs `if: always()`, so it must never be the thing that fails a job. One failure must not abandon
 * the rest, and a session that is already gone — the erasure flow really deleted its subject — is a normal
 * outcome, not an error.
 *
 * ⚠️ THE RECIPE DATA NEEDS NO AGE-GATED SWEEP, and that is a decision with an argument rather than an
 * omission. Leaked rows live in the per-PR logical database (ADR-0006), which the reaper deletes on PR
 * close; they carry run-scoped titles, so no anchored selector in any flow can match them; and no flow
 * asserts a feed CARDINALITY. ⛔ The day a flow asserts a public-feed count, that argument fails and this
 * command owes the analogue of `planE2EUserCleanup`'s leak sweep.
 *
 * @sideEffect Deletes recipes, collections and Clerk users.
 */
import { createClerkClient } from '@clerk/backend';
import {
    E2E_USER_QUERY,
    LEAKED_FIXTURE_MAX_AGE_MS,
    planE2EUserCleanup,
    resolveRunKey,
} from '@kitchensink/e2e-fixtures';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { clientFor } from './client.js';
import { readSeedEnvironment } from './env.js';
import { readSessionState, sessionStatePath } from './sessionState.js';
import { readWorld } from './recipeWorld.js';

const env = readSeedEnvironment(process.env);

/**
 * Delete everything one identity owns, tolerating a session that has already gone.
 *
 * @sideEffect Deletes recipes and collections.
 */
async function reclaim(label: string, client: RecipeServiceClient): Promise<void> {
    try {
        const world = await readWorld(client);

        for (const collection of world.collections) {
            await client.deleteCollection(collection.id);
        }

        for (const recipe of world.recipes) {
            await client.deleteRecipe(recipe.id);
        }

        console.error(
            `e2e-seed teardown: reclaimed ${world.recipes.length} recipes and ` +
                `${world.collections.length} collections from ${label}`,
        );
    } catch (error) {
        // The erasure flow really deletes its subject, and a crashed run may leave no session at all.
        // Neither is a reason to abandon the identity cleanup below.
        console.error(`e2e-seed teardown: could not reclaim ${label}'s data (continuing): ${String(error)}`);
    }
}

try {
    const state = readSessionState(sessionStatePath(process.env));

    await reclaim('the signer', clientFor(env.recipeOrigin, state.signer));
    await reclaim('the co-author', clientFor(env.recipeOrigin, state.coAuthor));
} catch (error) {
    console.error(`e2e-seed teardown: no session state to reclaim data with (continuing): ${String(error)}`);
}

const runKey = resolveRunKey();
const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
const candidates = await clerk.users.getUserList({ query: E2E_USER_QUERY, limit: 200 });
const plan = planE2EUserCleanup(
    candidates.data.map((user) => ({
        id: user.id,
        emails: user.emailAddresses.map((address) => address.emailAddress),
        createdAtMs: user.createdAt,
    })),
    { runKey, nowMs: Date.now(), maxAgeMs: LEAKED_FIXTURE_MAX_AGE_MS },
);

for (const id of [...plan.ownFixtureIds, ...plan.leakedIds]) {
    try {
        await clerk.users.deleteUser(id);
    } catch (error) {
        console.error(`e2e-seed teardown: could not delete ${id}: ${String(error)}`);
    }
}

console.error(
    `e2e-seed teardown: deleted ${plan.ownFixtureIds.length} own + ${plan.leakedIds.length} leaked ` +
        `identities for run ${runKey}.`,
);
