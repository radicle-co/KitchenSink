/**
 * PROVISION — lease this run's Maestro pool slots, sign them in, and seed the co-authored world, once, before any
 * flow runs.
 *
 * Prints the fixture manifest as `KEY=VALUE` lines on stdout and nothing else, so the runner script can
 * read it without parsing prose; diagnostics go to stderr.
 *
 * ⛔ IT CREATES NO CLERK USER (owner ruling 2026-09-13). The signer, the co-author and the erasure subject are
 * the Maestro tier's FIXED pool slots, provisioned by `poolAdmin` and serialized across runs by the job's
 * `test-pool-sandbox-maestro` concurrency group. A slot that is absent or unmarked fails this step — the fix is
 * `poolAdmin --apply`, never a user minted here. The data those slots own is emptied by `resetPool --tier
 * maestro` before this runs and again after the flows.
 *
 * ⛔ THE SIGN-INS HAPPEN HERE AND ONLY HERE. FAPI sign-in is per-IP rate limited; every later token comes
 * from the session handles this writes to disk.
 *
 * @sideEffect Looks up pool users, signs two of them in, writes a credential file, and creates recipes.
 */
import { resolveRunKey } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, firstAvailableSlot, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { maestroConsumableSlots, maestroShardCapacity, maestroSlotForShard } from '@kitchensink/e2e-fixtures/testPool';

import { clientFor } from './client.js';
import { readSeedEnvironment } from './env.js';
import { deriveFixtureManifest, manifestToEnvLines } from './fixtureManifest.js';
import { ensureIngredients, toCreateRequest } from './recipeWorld.js';
import { sessionStatePath, writeSessionState } from './sessionState.js';
import { resolveShard } from './shard.js';

const env = readSeedEnvironment(process.env);
// ⛔ THE SHARD IS RESOLVED FIRST, because everything below hangs off it: `resolveRunKey` reads the same
// `COMMISE_E2E_SHARD` to scope this shard's fixture TITLES apart from its sibling's, and the three identities
// leased below are the shard's own. An unsharded run is shard 1 and byte-identical to what ran before.
const shard = resolveShard(process.env);
const shardCount = maestroShardCapacity();
const runKey = resolveRunKey();
const manifest = deriveFixtureManifest(runKey, shard);
const port = clerkLeasePort(env.clerkSecretKey);

console.error(`e2e-seed provision: run ${runKey} (maestro shard ${shard}) against ${env.recipeOrigin}`);

// The erasure subject signs in on the DEVICE and is destroyed by the flow itself, so it needs no session here —
// only to exist, marked, with an `external_id`. The first such slot still standing is this run's; none standing
// is an error, never a skipped flow.
// ⛔ A STRIDE OVER THE CONSUMABLES, not the whole list (`maestroConsumableSlots`): two shards asking for "the
// first available" would both get the SAME subject, and one shard would then really erase the account the
// other had just leased. The stride is disjoint whatever has already been consumed.
const erasure = await firstAvailableSlot(maestroConsumableSlots(shard, shardCount), port);

console.error(`e2e-seed provision: erasure subject is pool slot ${erasure.slot.id}`);

// ⚠️ The SIGNER slot carries `premium` (the roster declares it), so the recipe service accepts the two PRIVATE
// recipes the seeded world contains. Without it `evaluateVisibility` denies a free-tier `user_created` private
// create outright, and three of the flows' anchors would have to become public — changing what those flows prove.
const signerSession = (
    await leaseSession({
        slot: maestroSlotForShard('signer', shard),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;
// Per identity, timestamped, on stderr (stdout is the manifest contract) — so a refused sign-in is placed between
// the last line printed and the error that names the next identity. Never the handle: it is a credential.
console.error(`${new Date().toISOString()} e2e-seed provision: signed in ${manifest.signInEmail}`);
const coAuthorSession = (
    await leaseSession({
        slot: maestroSlotForShard('coauthor', shard),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;
console.error(`${new Date().toISOString()} e2e-seed provision: signed in ${manifest.coAuthorEmail}`);

const statePath = sessionStatePath(process.env);
writeSessionState(statePath, { runKey, shard, signer: signerSession, coAuthor: coAuthorSession });
console.error(`e2e-seed provision: sessions established for the signer and co-author; state ${statePath}`);

// The discovery probe. It must exist in the catalog and attach to NOTHING — `searchNavigation` filters by
// it and asserts the feed collapses, so a run whose catalog lacks it would assert over an absent term.
const signerClient = clientFor(env.recipeOrigin, signerSession);
await signerClient.createIngredient(manifest.probeIngredient);

// The co-author's public recipe: the one row the signer does not own. Created once per run, and left alone
// by every reset (the reset reads the SIGNER's library, which cannot contain it).
const coAuthored = manifest.recipes.filter((recipe) => recipe.owner === 'coAuthor');
const coAuthorClient = clientFor(env.recipeOrigin, coAuthorSession);
const existing = await coAuthorClient.listRecipes({ pageSize: 100 });
const already = new Set(existing.data.map((recipe) => recipe.title));
const ingredientIds = await ensureIngredients(coAuthorClient, coAuthored);

for (const recipe of coAuthored) {
    if (already.has(recipe.title)) {
        continue;
    }

    await coAuthorClient.createRecipe(toCreateRequest(recipe, ingredientIds));
    console.error(`e2e-seed provision: co-author published "${recipe.title}"`);
}

// stdout is the CONTRACT.
for (const line of manifestToEnvLines(manifest, erasure.slot.email)) {
    console.log(line);
}
