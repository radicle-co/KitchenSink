/**
 * RESET — reconcile the signer's library to the manifest, before one flow.
 *
 * Runs ~35 times per job, in its own process each time, reusing the sessions `provision` established. The
 * common case is "nothing to do": the plan is a difference, so a settled world costs two reads.
 *
 * ⛔ EVERY FAILURE IS LOUD AND NON-ZERO. A reset that half-succeeded, or that could not mint a token, must
 * stop its flow from running at all — a flow driven against an unknown world produces failures that read
 * like app defects, which is exactly what turned one broken reseed into twenty-four misattributed reds.
 *
 * Usage: `e2e-seed reset [--mode seeded|empty|ambiguity]`
 *
 * `ambiguity` reconciles like `seeded`, then creates the signer's gate-AMBIGUOUS probe and waits for the gate's verdict
 * (`ensureAmbiguityProbe`). It needs `E2E_SEED_FOOD_URL`, which the probe's food is authored at.
 *
 * It also restores the signer's SETTINGS to "never chosen" (ADR-0059, `DELETE /api/v1/users/me/settings`): a flow that
 * chose a view must not change what the next flow sees. That needs `E2E_SEED_IDENTITY_URL`.
 *
 * @sideEffect Mints a Clerk token, creates/deletes recipes and collections, and deletes the signer's settings row.
 */
import { clientFor, foodClientFor } from './client.js';
import { readFoodOrigin, readIdentityOrigin, readSeedEnvironment } from './env.js';
import { AMBIGUITY_PROBE_FOOD_NAME, deriveFixtureManifest } from './fixtureManifest.js';
import { applyPlan, ensureAmbiguityProbe, readWorld } from './recipeWorld.js';
import { readSessionState, sessionStatePath } from './sessionState.js';
import { settingsResetVia } from './settingsReset.js';
import { assertPlatformsAgree } from './shard.js';
import { planWorldReset, type ResetMode } from './worldResetPlan.js';

/** Read the mode from argv, refusing anything the planner does not define. Pure. */
export function resetModeFrom(argv: readonly string[]): ResetMode {
    const index = argv.indexOf('--mode');
    const value = index === -1 ? 'seeded' : (argv[index + 1] ?? '');

    if (value !== 'seeded' && value !== 'empty' && value !== 'ambiguity') {
        throw new Error(`e2e-seed reset: --mode must be 'seeded', 'empty' or 'ambiguity', got '${value}'`);
    }

    return value;
}

const env = readSeedEnvironment(process.env);
const mode = resetModeFrom(process.argv.slice(2));
const state = readSessionState(sessionStatePath(process.env));

// ⛔ The state file is what `provision` actually leased, so a reset follows IT. But a job whose environment names
// another platform than the file does is a broken workflow, and resetting the file's signer would purge a lane the
// job does not hold. Absent in the environment is fine (a local run sets none).
assertPlatformsAgree(state.platform, process.env);

const manifest = deriveFixtureManifest(state.runKey, state.platform, state.shard);

const client = clientFor(env.recipeOrigin, state.signer);
const before = await readWorld(client);
const plan = planWorldReset(before, manifest, mode);

await applyPlan(client, plan);

if (mode === 'ambiguity') {
    // After the reconcile, so the probe is never mistaken for residue. Throws when the gate does not answer in time.
    const probeId = await ensureAmbiguityProbe(
        { food: foodClientFor(readFoodOrigin(process.env), state.signer), recipe: client },
        manifest.ambiguityProbe,
        AMBIGUITY_PROBE_FOOD_NAME,
    );
    console.error(`e2e-seed reset (ambiguity): "${manifest.ambiguityProbe.title}" is ${probeId}, every line AMBIGUOUS`);
}

await settingsResetVia(readIdentityOrigin(process.env)).reset(state.signer);

console.error(
    `e2e-seed reset (${mode}): -${plan.deleteRecipeIds.length} recipes, ` +
        `-${plan.deleteCollectionIds.length} collections, +${plan.create.length} recipes`,
);
