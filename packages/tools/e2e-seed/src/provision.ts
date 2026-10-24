/**
 * PROVISION — lease this run's Maestro pool slots, sign them in, and seed the co-authored world, once, before any
 * flow runs.
 *
 * Prints the fixture manifest as `KEY=VALUE` lines on stdout and nothing else, so the runner script can
 * read it without parsing prose; diagnostics go to stderr.
 *
 * ⛔ IT CREATES NO CLERK USER. The signer, the co-author and the erasure subject are the Maestro tier's FIXED pool
 * slots, provisioned by `poolAdmin` and serialized across runs by the job's per-lane `test-pool-sandbox-maestro[-ios]-N`
 * concurrency group. The job's refill step tops up the erasure subjects through `poolAdmin` just before this runs
 * (`poolAdmin.ts` records that ruling); a slot that is still absent or unmarked fails this step, and nothing here
 * mints a user. The data those slots own is emptied by `resetPool --tier
 * maestro` before this runs and again after the flows.
 *
 * ⛔ THE SIGN-INS HAPPEN HERE AND ONLY HERE. FAPI sign-in is per-IP rate limited; every later token comes
 * from the session handles this writes to disk.
 *
 * @sideEffect Looks up pool users, signs two of them in, writes a credential file, authors foods, and creates recipes.
 */
import { remintFromSession, resolveRunKey } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseErasureSubject, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { maestroSlotForShard } from '@kitchensink/e2e-fixtures/testPool';

import { clientFor, foodClientFor } from './client.js';
import { readFoodOrigin, readIdentityOrigin, readSeedEnvironment } from './env.js';
import { ensureRemoteProbeWords, probePortOver } from './ensureRemoteProbeWords.js';
import { deriveFixtureManifest, manifestToEnvLines } from './fixtureManifest.js';
import { candidatesFor } from './remoteProbeWords.js';
import {
    ensureCapFoods,
    ensureIngredients,
    ensurePrivateFoodRecipe,
    ensureProbeFood,
    toCreateRequest,
} from './recipeWorld.js';
import { sessionStatePath, writeSessionState } from './sessionState.js';
import { resolveMaestroPlatform, resolveShard } from './shard.js';
import { assertSignerEntitled } from './signerEntitlement.js';
import { memoizingTokenSource } from './tokenSource.js';

const env = readSeedEnvironment(process.env);
// The fixture foods are authored at food and bound at recipe (plan 002 S5), so provision needs both origins.
const foodOrigin = readFoodOrigin(process.env);
// And identity's, to check the signer is entitled before any of it is written (`signerEntitlement.ts`).
const identityOrigin = readIdentityOrigin(process.env);
// ⛔ THE SHARD IS RESOLVED FIRST, because everything below hangs off it: `resolveRunKey` reads the same
// `COMMISE_E2E_SHARD` to scope this shard's fixture TITLES apart from its sibling's, and the three identities
// leased below are the shard's own. An unsharded run is shard 1 and byte-identical to what ran before.
const shard = resolveShard(process.env);
// ⛔ AND THE PLATFORM, which names the other axis of the lane (iOS has pool lanes of its own, 2026-10-13). Absent is
// `android`, the runner's own default; an unknown value throws rather than leasing the wrong platform's signer.
const platform = resolveMaestroPlatform(process.env);
const runKey = resolveRunKey();
const manifest = deriveFixtureManifest(runKey, platform, shard);
const port = clerkLeasePort(env.clerkSecretKey);

console.error(`e2e-seed provision: run ${runKey} (maestro ${platform} shard ${shard}) against ${env.recipeOrigin}`);

// The erasure subject signs in on the DEVICE and is destroyed by the flow itself, so it needs no session here —
// only to exist, marked, with an `external_id`. The first such slot still standing is this run's; none standing
// is an error, never a skipped flow.
// ⛔ ONLY A PLATFORM'S ERASURE SHARD LEASES ONE, from that platform's own subjects (`maestroErasureSlots` states the
// lease contract): the runner pins every erasing flow to that shard, and its concurrency lane is what keeps two runs
// off one subject. Every other shard leases none, and its manifest names none.
const erasure = await leaseErasureSubject(platform, shard, port);

console.error(
    erasure === null
        ? `e2e-seed provision: maestro ${platform} shard ${shard} runs no erasing flow, so it leases no erasure subject`
        : `e2e-seed provision: erasure subject is pool slot ${erasure.slot.id}`,
);

// ⚠️ The SIGNER slot carries the `premium` ROLE (the roster declares it), so the recipe service accepts the two PRIVATE
// recipes the seeded world contains. Without it `evaluateVisibility` denies a free-tier `user_created` private
// create outright, and three of the flows' anchors would have to become public — changing what those flows prove.
const signerSession = (
    await leaseSession({
        slot: maestroSlotForShard('signer', platform, shard),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;
// Per identity, timestamped, on stderr (stdout is the manifest contract) — so a refused sign-in is placed between
// the last line printed and the error that names the next identity. Never the handle: it is a credential.
console.error(`${new Date().toISOString()} e2e-seed provision: signed in ${manifest.signInEmail}`);

// ⛔ BEFORE ANYTHING IS SEEDED: the signer must hold the paid role the roster declares, or every per-flow reset is
// refused `400 INVALID_VISIBILITY` and the run reports one red per flow for a single missing `poolAdmin --apply`.
await assertSignerEntitled({
    identityOrigin,
    signerEmail: manifest.signInEmail,
    token: memoizingTokenSource(signerSession, { remint: remintFromSession }),
});
console.error(`e2e-seed provision: ${manifest.signInEmail} is entitled to the paid features`);
const coAuthorSession = (
    await leaseSession({
        slot: maestroSlotForShard('coauthor', platform, shard),
        publishableKey: env.clerkPublishableKey,
        origin: env.webOrigin,
        port,
    })
).handle;
console.error(`${new Date().toISOString()} e2e-seed provision: signed in ${manifest.coAuthorEmail}`);

// The discovery probe. `searchNavigation` filters discovery by it and asserts the feed collapses, so it must be a
// FOOD the signer can pick (the filter keys on food ids — plan 002 R45) and attach to NOTHING. Authored AS THE
// SIGNER, because the device signs in as the signer and an authored food is visible to its author only.
const signerClient = clientFor(env.recipeOrigin, signerSession);
const signerFoods = { food: foodClientFor(foodOrigin, signerSession), recipe: signerClient };
const probe = await ensureProbeFood(signerFoods, manifest.probeIngredient);
console.error(`e2e-seed provision: discovery probe "${probe.name}" is food ${probe.foodId ?? ''}`);

// The foods `recipes/discoverIngredientCap` fills the filter with, authored as the signer for the probe's reason.
const capFoods = await ensureCapFoods(signerFoods, manifest.capFoodNames);
console.error(`e2e-seed provision: ${capFoods.length} cap foods named "${manifest.capFoodPrefix} N"`);

// The remote-food probe words (owner ruling 2026-10-18): chosen by asking the REAL progressive search as the signer, so
// a stage whose catalog has outgrown a word fails HERE, naming the word and why, and no flow ever types a stale literal.
// ⛔ The signer only: it is a test principal, so the roots a pick of these words creates are attributed and purgeable.
// ⛔ Once per run: the per-flow reset makes no source call.
const probeWords = await ensureRemoteProbeWords(
    {
        port: probePortOver(signerFoods.food, Date.now),
        now: Date.now,
        sleep: async (milliseconds) => {
            await new Promise((resolve) => setTimeout(resolve, milliseconds));
        },
        authorFood: async (name) => ensureProbeFood(signerFoods, name),
        log: (text) => console.error(text),
    },
    { candidates: candidatesFor(platform), runKey, stage: env.recipeOrigin },
);
console.error(
    `e2e-seed provision: remote probe words append "${probeWords.appendWord}", change "${probeWords.changeWord}", ` +
        `ambiguity "${probeWords.ambiguityWord}"`,
);

// ⛔ Written AFTER the probe words, because the per-flow reset reads the ambiguity word from it (`reset --mode
// ambiguity` names the probe's food and lines for it) and must never choose one itself. A provision that failed before
// here leaves no state file, and every reset then refuses to run, which is the loud failure that case needs.
const statePath = sessionStatePath(process.env);
writeSessionState(statePath, {
    runKey,
    platform,
    shard,
    signer: signerSession,
    coAuthor: coAuthorSession,
    ambiguityWord: probeWords.ambiguityWord,
});
console.error(`e2e-seed provision: sessions established for the signer and co-author; state ${statePath}`);

const coAuthorClient = clientFor(env.recipeOrigin, coAuthorSession);

// The co-author's public recipe bound to the co-author's PRIVATE food: the signer reads its line with no name
// (`recipes/privateFoodStandIn`). The food and the recipe are one fixture, checked together — never by title alone.
// ⚠️ Published BEFORE the risotto below, so the risotto stays newer and keeps its place at the front of the "New"
// rail, where `recipes/accessibility` waits for it (see `PRIVATE_FOOD_RECIPE`).
const privateFood = await ensurePrivateFoodRecipe(
    { food: foodClientFor(foodOrigin, coAuthorSession), recipe: coAuthorClient },
    manifest.privateFoodRecipe,
    manifest.privateFoodName,
);
console.error(
    `e2e-seed provision: co-author's private-food recipe "${manifest.privateFoodRecipe.title}" is ` +
        `${privateFood.recipeId} (${privateFood.plan.action}, ${privateFood.plan.deleteRecipeIds.length} stale rows deleted)`,
);

// The co-author's declared-name recipes (the risotto): public rows the signer does not own. Created once per run,
// and left alone by every reset (the reset reads the SIGNER's library, which cannot contain them).
const coAuthored = manifest.recipes.filter((recipe) => recipe.owner === 'coAuthor');
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
for (const line of manifestToEnvLines(manifest, { erasureEmail: erasure?.slot.email ?? null, probeWords })) {
    console.log(line);
}
