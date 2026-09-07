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
 * Usage: `e2e-seed reset [--mode seeded|empty]`
 *
 * @sideEffect Mints a Clerk token, and creates/deletes recipes and collections.
 */
import { clientFor } from './client.js';
import { readSeedEnvironment } from './env.js';
import { deriveFixtureManifest } from './fixtureManifest.js';
import { applyPlan, readWorld } from './recipeWorld.js';
import { readSessionState, sessionStatePath } from './sessionState.js';
import { planWorldReset, type ResetMode } from './worldResetPlan.js';

/** Read the mode from argv, refusing anything the planner does not define. Pure. */
export function resetModeFrom(argv: readonly string[]): ResetMode {
    const index = argv.indexOf('--mode');
    const value = index === -1 ? 'seeded' : (argv[index + 1] ?? '');

    if (value !== 'seeded' && value !== 'empty') {
        throw new Error(`e2e-seed reset: --mode must be 'seeded' or 'empty', got '${value}'`);
    }

    return value;
}

const env = readSeedEnvironment(process.env);
const mode = resetModeFrom(process.argv.slice(2));
const state = readSessionState(sessionStatePath(process.env));
const manifest = deriveFixtureManifest(state.runKey);

const client = clientFor(env.recipeOrigin, state.signer);
const before = await readWorld(client);
const plan = planWorldReset(before, manifest, mode);

await applyPlan(client, plan);

console.error(
    `e2e-seed reset (${mode}): -${plan.deleteRecipeIds.length} recipes, ` +
        `-${plan.deleteCollectionIds.length} collections, +${plan.create.length} recipes`,
);
