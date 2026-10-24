/**
 * ENSURE DOWNGRADED WORLD — make the downgraded owner's private recipe and collection exist, and leave the owner
 * SETTLED, on every CI run (owner ruling 2026-10-18; plan 2026-10-14-009 Q5/T1/T2).
 *
 * ## Why this runs in CI
 *
 * The world lives in the per-PR recipe database, which Sandbox Down and the midnight reclaim DROP every cycle, so it
 * vanishes. It used to be written by hand in three steps (`poolAdmin.ts` header); step 1 could never re-arm an
 * already-settled owner, so the world could not even be rebuilt. The `downgraded-owner-world` job of
 * `deployedE2eTiers.yml` runs this once per run, BEFORE any consumer (the web specs, the Maestro flows) signs in as that
 * owner, so nothing else touches the lane while it is raised.
 *
 * ## What it does, and the one thing it avoids
 *
 * It reads the owner's own rows (no paid role needed) and decides with `planDowngradedWorldRun`:
 *
 *   - `ready`      — the world stands and the owner is settled: nothing is written and the owner is NEVER raised. This is
 *                    the common path.
 *   - `settleOnly` — the world stands but the owner was left raised (a run killed before its `finally`): settle it.
 *   - `reseed`     — the world is missing or stale: raise ONLY this lane, mint a FRESH token (the roles ride in its
 *                    claims), check identity calls the owner entitled, write the world, then settle in a `finally`.
 *
 * Every path ends by minting another fresh token and asking identity: the consumers ASSUME the owner is not entitled, so
 * a downgrade that did not hold fails the run.
 *
 * ⛔ A token is never reused across the raise or the settle. `memoizingTokenSource` caches for 45 s and the roles are in
 * the signed claims, so a source built before the raise would send the OLD roles and the recipe service would answer
 * `400 INVALID_VISIBILITY`.
 *
 * ⛔ The role write stays in `poolAdmin.ts` (`setLanePhase`): `metadataSingleWriter.test.ts` allows no other module to
 * write `public_metadata`. This file composes it; it holds no Clerk write of its own.
 *
 * ⚠️ RESIDUAL: Clerk roles are per tenant, so while a run reseeds, the owner is premium for any OTHER PR's consumer
 * signing in as the lane. The job's concurrency group serialises runs of this job; a SIGKILLed run skips its `finally`
 * and the next run's `settleOnly` repairs it.
 *
 * Usage: `npm run ensure-downgraded --workspace=packages/tools/e2e-seed`, with `CLERK_SECRET_KEY` (a development key —
 * anything else is refused before a session is signed in), `CLERK_PUBLISHABLE_KEY`, `E2E_SEED_RECIPE_URL`,
 * `E2E_SEED_WEB_ORIGIN` and `E2E_SEED_IDENTITY_URL`. Never prints a token or a key.
 *
 * @pattern Reconciler — `planDowngradedWorldRun` is the pure diff, `ensureDowngradedWorld` the thin impure applier
 * @pattern Template Method — raise, seed, settle in a `finally`: the settle is a guarantee, not a step
 * @pattern Port — every boundary (Clerk admin, sign-in, tokens, recipe, identity) is injected, so the order is testable
 */
import { remintFromSession, type SessionHandle } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import {
    clerkPoolAdminPort,
    laneHoldsPhase,
    setLanePhase,
    type PoolAdminPort,
} from '@kitchensink/e2e-fixtures/poolAdmin';
import { DOWNGRADED_OWNER_LANE_ID, slotFor, type PoolSlot } from '@kitchensink/e2e-fixtures/testPool';
import { pathToFileURL } from 'node:url';

import { clientWithToken } from './client.js';
import {
    planDowngradedWorldRun,
    readDowngradedOwnerSnapshot,
    seedDowngradedOwnerWorld,
    type DowngradedOwnerPlan,
    type DowngradedOwnerSnapshot,
    type WorldRun,
} from './downgradedOwnerWorld.js';
import { readIdentityOrigin, readSeedEnvironment, type SeedEnvironment } from './env.js';
import {
    assertSignerEntitled,
    assertSignerNotEntitled,
    type EntitlementDeps,
    type EntitlementInput,
} from './signerEntitlement.js';
import { memoizingTokenSource } from './tokenSource.js';

/** A per-request bearer callback, as `RecipeServiceClient` and the entitlement read both take one. */
export type TokenFn = (options?: { readonly forceRefresh?: boolean }) => Promise<string>;

/** Every boundary the run crosses. */
export interface EnsureDowngradedWorldDeps {
    readonly slot: PoolSlot;
    /** The Clerk Backend API, for the lane's role writes. */
    readonly admin: PoolAdminPort;
    /** Sign the owner in. */
    readonly signIn: () => Promise<SessionHandle>;
    /** A NEW token source over the session, with its own cache. Called again whenever the roles have moved. */
    readonly tokenSource: (handle: SessionHandle) => TokenFn;
    /** The owner's own recipes and collections, as the owner. */
    readonly readSnapshot: (token: TokenFn) => Promise<DowngradedOwnerSnapshot>;
    /** Write the world, as the owner — only while it is raised. */
    readonly seedWorld: (token: TokenFn) => Promise<DowngradedOwnerPlan>;
    readonly identity: { readonly origin: string; readonly entitlement?: EntitlementDeps };
    readonly log: (line: string) => void;
}

/**
 * Settle the lane. A failure here leaves the owner PREMIUM for every consumer, so it is announced as an error whoever
 * catches it.
 *
 * @sideEffect Writes the lane's roles; logs.
 */
async function settleLane(deps: EnsureDowngradedWorldDeps): Promise<void> {
    try {
        await setLanePhase(deps.admin, deps.slot, 'settled');
    } catch (error) {
        deps.log(
            `::error::the downgraded owner ${deps.slot.email} could NOT be settled and is left PREMIUM — every consumer ` +
                `signing in as it will fail until poolAdmin --apply --settle-downgraded (or the next run) settles it: ` +
                `${error instanceof Error ? error.message : String(error)}`,
        );

        throw error;
    }
}

/**
 * Ensure the world exists and the owner is settled.
 *
 * @returns What was done: `ready`, `settleOnly` or `reseed`.
 * @throws When a boundary fails, when the owner is not entitled after the raise, when the settle does not hold, or
 *   when identity still calls the owner entitled afterwards.
 * @sideEffect Signs the owner in, reads (and on `reseed` writes) its rows, and writes its roles through `poolAdmin`.
 */
export async function ensureDowngradedWorld(deps: EnsureDowngradedWorldDeps): Promise<WorldRun> {
    const handle = await deps.signIn();
    const lane = (await laneHoldsPhase(deps.admin, deps.slot, 'settled')) ? 'settled' : 'unsettled';
    const snapshot = await deps.readSnapshot(deps.tokenSource(handle));
    const run = planDowngradedWorldRun(snapshot, lane);
    const asOwner = (token: TokenFn): EntitlementInput => ({
        identityOrigin: deps.identity.origin,
        signerEmail: deps.slot.email,
        token,
    });

    if (run === 'settleOnly') {
        deps.log(`e2e-seed ensure-downgraded: the world stands but ${deps.slot.email} was left raised — settling it`);
        await settleLane(deps);
    } else if (run === 'reseed') {
        deps.log(
            `e2e-seed ensure-downgraded: the world is missing or stale — raising ${deps.slot.email} to rebuild it`,
        );

        let failure: { readonly error: unknown } | undefined;

        try {
            await setLanePhase(deps.admin, deps.slot, 'seeding');

            // A source built AFTER the raise: the roles are in the signed claims, and the one that read the snapshot
            // above (and its 45 s cache) still carries the old ones.
            const raised = deps.tokenSource(handle);

            await assertSignerEntitled(asOwner(raised), deps.identity.entitlement);

            const plan = await deps.seedWorld(raised);

            deps.log(
                `e2e-seed ensure-downgraded: recipe ${plan.createRecipe ? 'created' : 'kept'}, collection ` +
                    `${plan.createCollection ? 'created' : 'kept'}, ` +
                    `${plan.deleteRecipeIds.length + plan.deleteCollectionIds.length} stale rows deleted`,
            );
        } catch (error) {
            failure = { error };
        }

        // Whatever happened above, the owner does not stay premium. A settle failure is announced by `settleLane`; when
        // there is also a seed failure, that one is the cause and is the one rethrown.
        try {
            await settleLane(deps);
        } catch (settleError) {
            throw failure === undefined ? settleError : failure.error;
        }

        if (failure !== undefined) {
            throw failure.error;
        }
    } else {
        deps.log(`e2e-seed ensure-downgraded: the world stands and ${deps.slot.email} is settled — nothing to do`);
    }

    // The consumers assume this. A token minted before the settle still carries the raised roles, so mint another.
    await assertSignerNotEntitled(asOwner(deps.tokenSource(handle)), deps.identity.entitlement);
    deps.log(`e2e-seed ensure-downgraded: identity reports ${deps.slot.email} is not entitled (${run})`);

    return run;
}

/**
 * The real boundaries for an environment.
 *
 * ⛔ The Clerk admin port is built FIRST: it is what refuses a key that is not a development-instance key, and that
 * must happen before anything signs in or writes.
 *
 * @throws When the secret key is not a development (`sk_test_`) key.
 */
export function ensureDowngradedWorldDeps(env: SeedEnvironment, identityOrigin: string): EnsureDowngradedWorldDeps {
    const admin = clerkPoolAdminPort(env.clerkSecretKey);
    const slot = slotFor('roles', DOWNGRADED_OWNER_LANE_ID);

    return {
        slot,
        admin,
        signIn: async () =>
            (
                await leaseSession({
                    slot,
                    publishableKey: env.clerkPublishableKey,
                    origin: env.webOrigin,
                    port: clerkLeasePort(env.clerkSecretKey),
                })
            ).handle,
        tokenSource: (handle) => memoizingTokenSource(handle, { remint: remintFromSession }),
        readSnapshot: (token) => readDowngradedOwnerSnapshot(clientWithToken(env.recipeOrigin, token)),
        seedWorld: (token) => seedDowngradedOwnerWorld(clientWithToken(env.recipeOrigin, token)),
        identity: { origin: identityOrigin },
        log: (line) => console.error(line),
    };
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment, calls Clerk, the recipe service and identity, and sets the exit code.
 */
async function main(): Promise<void> {
    try {
        const deps = ensureDowngradedWorldDeps(readSeedEnvironment(process.env), readIdentityOrigin(process.env));

        await ensureDowngradedWorld(deps);
    } catch (error) {
        console.error(`::error::ensure-downgraded failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
