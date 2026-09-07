/**
 * PROVISION — establish this run's identities, sessions and co-authored world, once, before any flow runs.
 *
 * Prints the fixture manifest as `KEY=VALUE` lines on stdout and nothing else, so the runner script can
 * read it without parsing prose; diagnostics go to stderr. The same contract `provisionSignInFixture`
 * established, reused rather than replaced.
 *
 * ⛔ THE SIGN-INS HAPPEN HERE AND ONLY HERE. FAPI sign-in is per-IP rate limited; every later token comes
 * from the session handles this writes to disk.
 *
 * @sideEffect Creates Clerk users, signs them in, writes a credential file, and creates recipes.
 */
import { createClerkClient } from '@clerk/backend';
import {
    auxiliaryFixtureUsername,
    establishSession,
    resolveRunKey,
    signInFixtureUsername,
} from '@kitchensink/e2e-fixtures';

import { clientFor } from './client.js';
import { provisionIdentity } from './clerkIdentities.js';
import { readSeedEnvironment } from './env.js';
import { deriveFixtureManifest, manifestToEnvLines } from './fixtureManifest.js';
import { ensureIngredients, toCreateRequest } from './recipeWorld.js';
import { sessionStatePath, writeSessionState } from './sessionState.js';

const env = readSeedEnvironment(process.env);
const runKey = resolveRunKey();
const manifest = deriveFixtureManifest(runKey);
const clerk = createClerkClient({ secretKey: env.clerkSecretKey });

console.error(`e2e-seed provision: run ${runKey} against ${env.recipeOrigin}`);

// ⚠️ The SIGNER is granted `premium` so the recipe service accepts the two PRIVATE recipes the seeded world
// contains. Without it `evaluateVisibility` denies a free-tier `user_created` private create outright, and
// three of the flows' anchors would have to become public — changing what those flows prove.
const signer = await provisionIdentity(clerk, {
    email: manifest.signInEmail,
    username: signInFixtureUsername(runKey),
    password: manifest.password,
    firstName: 'Commise',
    lastName: 'Signin',
    premium: true,
});
const coAuthor = await provisionIdentity(clerk, {
    email: manifest.coAuthorEmail,
    username: auxiliaryFixtureUsername(runKey, 'author'),
    password: manifest.password,
    firstName: 'Commise',
    lastName: 'Author',
    premium: false,
});
// The erasure subject signs in on the DEVICE and is deleted by the flow itself, so it needs an identity and
// an `external_id` but no session here.
await provisionIdentity(clerk, {
    email: manifest.erasureEmail,
    username: auxiliaryFixtureUsername(runKey, 'erasure'),
    password: manifest.password,
    firstName: 'Commise',
    lastName: 'Erasure',
    premium: false,
});

console.error(`e2e-seed provision: three identities ready (signer external_id ${signer.externalId})`);

const signerSession = await establishSession({
    email: manifest.signInEmail,
    publishableKey: env.clerkPublishableKey,
    origin: env.webOrigin,
});
const coAuthorSession = await establishSession({
    email: manifest.coAuthorEmail,
    publishableKey: env.clerkPublishableKey,
    origin: env.webOrigin,
});

const statePath = sessionStatePath(process.env);
writeSessionState(statePath, { runKey, signer: signerSession, coAuthor: coAuthorSession });
console.error(`e2e-seed provision: sessions established for ${coAuthor.email} and the signer; state ${statePath}`);

// The discovery probe. It must exist in the catalog and attach to NOTHING — `search-navigation` filters by
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
for (const line of manifestToEnvLines(manifest)) {
    console.log(line);
}
