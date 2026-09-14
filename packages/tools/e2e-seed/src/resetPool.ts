/**
 * RESET POOL — purge the data a tier's leased pool slots own on this stage, before the tier runs and again,
 * `if: always()`, after it.
 *
 * ## Why this, and why twice (owner ruling 2026-09-13)
 *
 * > "The k6 and e2e tests need to guarantee that they not only clean up their data but to scope the data such
 * > that it won't conflict with real data."
 *
 * Every run now signs in as a FIXED pool user, so anything that user owns on the stage is residue of some run —
 * this one, or one that was cancelled or lost its runner before its own cleanup ran. Reset BEFORE is what makes
 * a run independent of the last one's fate (and it FAILS the job: a tier run against an unknown world reports
 * failures that read like app defects). Reset AFTER, in its own `always()` step, runs on cancellation too — which
 * Playwright's `globalTeardown` does not (ADR-0032 §5).
 *
 * ## What it resets, and what it cannot
 *
 * EVERYTHING the slot owns in the recipe service, through the test principal's SELF-PURGE (ADR-0040 §5):
 * `POST /api/v1/account/test-reset`, then its status polled until the worker reports `completed`. The worker
 * hard-deletes every user-keyed row — recipes (tombstoned ones included), collections, ratings the slot left on
 * other users' recipes, parse jobs, both correction tables, analytics rows — and sweeps the slot's S3 prefix. A
 * `failed` job, a door that refuses the slot, or a purge still running at the deadline fails the slot.
 *
 * The library is read BEFORE the purge (the counts in the log, and the first authenticated request, which is what
 * registers a test principal with the service) and AGAIN after it: a purge that reports `completed` while the owner
 * API still lists rows fails the slot, so the green is evidence rather than the worker's say-so.
 *
 * ⛔ THE PHASE-1 SOFT DELETE IS GONE, not kept as a belt: while a purge is active the service answers every
 * mutation from the slot with `423`, so issuing deletes around it could only fail the reset, and what they deleted
 * the purge deletes anyway. `planWorldReset`/`applyPlan` still serve the Maestro per-flow reset (`reset.ts`).
 *
 * What it still cannot reach: object VERSIONS in the versioned buckets (the purge leaves delete markers — ADR-0040's
 * residual risk, the gap ADR-0013 records for erasure); consumable erasure subjects, which are destroyed rather
 * than reset; and IMPORTED food, which the catalog keeps by owner ruling. A slot's AUTHORED foods ARE purged — owner
 * ruling 2026-09-14, "purge them too as long as it doesn't change the desired flow for normal users" — through
 * food-service's own test-purge door (`POST /api/v1/foods/authored/test-purge`), after the recipe purge completes;
 * a refusal there fails the slot like a refusal of the recipe purge.
 *
 * ## Sessions
 *
 * A stored handle (`--handles <file>`, the `Record<slotId, SessionHandle>` the k6 pool writes) is re-minted
 * first, because a sign-in is the per-IP-throttled half; a slot with no usable handle is LEASED — resolved,
 * checked against its provisioning, and signed in (`leaseSession`).
 *
 * Usage: `resetPool --tier web --shard N | --tier maestro | --tier k6 --vus N | --tier linkage [--handles file]`,
 * with `E2E_SEED_RECIPE_URL`, `E2E_SEED_FOOD_URL` and `E2E_SEED_WEB_ORIGIN` naming the stage.
 *
 * ⛔ EXIT STATUS: non-zero when any slot could not be reset, after attempting every slot. Whether that reddens the
 * job is the WORKFLOW's decision — the before-step must, the after-step reports.
 *
 * @pattern Command — one reset over a tier's slots: request each slot's purge in turn, each wait running on meanwhile
 * @pattern Strategy — `session`, a stored handle before a fresh lease, injected so the rules are testable without Clerk
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { remintFromSession, type SessionCredential, type SessionHandle } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { k6VuSlots, POOL_ROSTER, slotFor, slotForShard, type PoolSlot } from '@kitchensink/e2e-fixtures/testPool';
import {
    isFetchUnavailableError as isFoodFetchUnavailableError,
    isFoodServiceClientError,
    isNotFoundError as isFoodNotFoundError,
    type FoodServiceClient,
} from '@kitchensink/food-service-client';
import pRetry from 'p-retry';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';

import { clientFor, foodClientFor } from './client.js';
import { readFoodOrigin, readSeedEnvironment } from './env.js';
import { readWorld } from './recipeWorld.js';
import { awaitPurge, DEFAULT_PURGE_TIMING, requestPurge, type PurgeTiming } from './testReset.js';
import { isTransientStatus } from './transientStatus.js';

/** Which slots a reset addresses. The stubbed web tier is absent on purpose: it authors nothing on a stage. */
export type ResetRequest =
    | { readonly tier: 'web'; readonly shard: number }
    | { readonly tier: 'maestro' }
    | { readonly tier: 'k6'; readonly vus: number }
    | { readonly tier: 'linkage' };

/**
 * One slot's result. The recipe counts are what the library listed before the purge that removed them;
 * `authoredFoods` is what the food-service door reported deleting, or `notPurged` when the caller passed no port.
 */
export type SlotResetOutcome =
    | {
          readonly slot: PoolSlot;
          readonly ok: true;
          readonly jobId: string;
          readonly deletedRecipes: number;
          readonly deletedCollections: number;
          readonly authoredFoods: number | 'notPurged';
      }
    | { readonly slot: PoolSlot; readonly ok: false; readonly reason: string };

/**
 * The seam that removes a slot's AUTHORED foods from food-service (owner ruling 2026-09-14: "purge them too as long
 * as it doesn't change the desired flow for normal users").
 *
 * A port because the far side is food-service's own test-purge door, whose contract is authored in that service
 * (ADR-0014) — this package states only what a reset needs from it. {@link authoredFoodPurgeVia} is its adapter.
 */
export interface AuthoredFoodPurgePort {
    /**
     * Remove the session's own PRIVATE authored foods; resolves to how many were deleted.
     *
     * ⚠️ The door also reports how many PROMOTED authored foods it kept, because other cooks may depend on them. A
     * pool slot cannot promote a food (a promotion is human-moderated, ADR-0029), so that count is not reported here.
     */
    readonly purgeOwn: (handle: SessionHandle) => Promise<number>;
}

/** How the food half rides out a cold food-service task. */
export interface FoodPurgeRetry {
    readonly retries: number;
    readonly intervalMs: number;
}

/**
 * The default: three retries, two seconds apart. The door is synchronous and idempotent (a repeat deletes nothing),
 * so a retry is always safe; the bound is short because, unlike the recipe purge, there is no job running on
 * server-side to wait for — only a task to wake.
 */
const DEFAULT_FOOD_PURGE_RETRY: FoodPurgeRetry = { retries: 3, intervalMs: 2_000 };

/** A food-service failure the stage recovers from on its own: no answer in time, a `429`, or a `5xx`. Pure. */
function isTransientFoodFailure(error: unknown): boolean {
    if (isFoodFetchUnavailableError(error)) {
        return true;
    }

    const status = isFoodServiceClientError(error) ? error.status : undefined;

    return status !== undefined && isTransientStatus(status);
}

/**
 * The {@link AuthoredFoodPurgePort} over food-service's `POST /api/v1/foods/authored/test-purge`.
 *
 * A transient failure is retried within a short bound, for the reason the recipe half's poll tolerates one: a
 * `pr-{N}` preview's first request to an idle task is ordinarily slow, and the reset-before step is fatal. A `404` is
 * NEVER retried — it is the door refusing the slot, not a cold start.
 *
 * @param client - A food-service client authenticated as the handle's identity.
 * @param retry - The transient-failure bound.
 * @returns The port.
 * @sideEffect The returned port hard-deletes the caller's private authored foods.
 */
export function authoredFoodPurgeVia(
    client: (handle: SessionHandle) => Pick<FoodServiceClient, 'purgeOwnAuthoredFoods'>,
    retry: FoodPurgeRetry = DEFAULT_FOOD_PURGE_RETRY,
): AuthoredFoodPurgePort {
    return {
        purgeOwn: async (handle) => {
            try {
                const counts = await pRetry(() => client(handle).purgeOwnAuthoredFoods(), {
                    retries: retry.retries,
                    minTimeout: retry.intervalMs,
                    maxTimeout: retry.intervalMs,
                    shouldRetry: ({ error }) => isTransientFoodFailure(error),
                });

                return counts.deletedAuthoredFoods;
            } catch (error) {
                if (isFoodNotFoundError(error)) {
                    throw new Error(
                        'food-service does not recognise this slot as a test principal (its authored-food purge ' +
                            'door answered 404) — the slot lacks the poolAdmin marker or its synced external id, or ' +
                            'this stage does not route POST /api/v1/foods/authored/test-purge',
                        { cause: error },
                    );
                }

                throw error;
            }
        },
    };
}

/** What a reset needs from the world. */
export interface SlotResetDeps {
    readonly session: (slot: PoolSlot) => Promise<SessionHandle>;
    readonly client: (handle: SessionHandle) => RecipeServiceClient;
    readonly purge?: PurgeTiming;
    /**
     * REQUIRED, and `undefined` must be written out: a caller has to decide, visibly, that authored foods are not
     * purged — and every outcome line then says so rather than letting a green reset imply it.
     */
    readonly authoredFoods: AuthoredFoodPurgePort | undefined;
}

const positiveInteger = (raw: string | undefined): number | undefined => {
    const value = Number(raw);

    return raw !== undefined && Number.isInteger(value) && value >= 1 ? value : undefined;
};

/** Read the request from argv, refusing anything incomplete. Pure. */
export function parseResetArgs(argv: readonly string[]): ResetRequest {
    const flag = (name: string): string | undefined => {
        const index = argv.indexOf(name);

        return index === -1 ? undefined : argv[index + 1];
    };

    const tier = flag('--tier');

    if (tier === 'maestro' || tier === 'linkage') {
        return { tier };
    }

    if (tier === 'web') {
        const shard = positiveInteger(flag('--shard'));

        if (shard === undefined) {
            throw new Error('resetPool: --tier web needs --shard <positive integer>');
        }

        return { tier, shard };
    }

    if (tier === 'k6') {
        const vus = positiveInteger(flag('--vus'));

        if (vus === undefined) {
            throw new Error('resetPool: --tier k6 needs --vus <positive integer>');
        }

        return { tier, vus };
    }

    throw new Error(`resetPool: --tier must be web, maestro, k6 or linkage, got '${String(tier)}'`);
}

/**
 * The slots a request resets. Pure.
 *
 * Consumable slots are never included: an erasure subject is destroyed by its flow, and leasing one to reset it
 * would fail on exactly the runs where the flow succeeded.
 */
export function resetTargets(request: ResetRequest): readonly PoolSlot[] {
    switch (request.tier) {
        case 'web':
            return [slotForShard('web', request.shard)];
        case 'maestro':
            return POOL_ROSTER.maestro.filter((lane) => !lane.consumable).map((lane) => slotFor('maestro', lane.id));
        case 'k6':
            return [...k6VuSlots(request.vus), slotFor('k6', 'admin')];
        case 'linkage':
            return [slotFor('linkage', 'linkage')];
    }
}

/** The reason text of anything thrown. Pure. */
const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A slot whose purge was requested, and what its library held before. */
interface RequestedPurge {
    readonly slot: PoolSlot;
    readonly handle: SessionHandle;
    readonly client: RecipeServiceClient;
    readonly jobId: string;
    readonly before: { readonly recipes: number; readonly collections: number };
}

/**
 * Reset every slot, never abandoning the rest on a failure.
 *
 * Sign-ins and purge REQUESTS go strictly one slot at a time, each awaited, because a lease is a throttled Clerk
 * sign-in (`establishSessionCallers.test.ts`). Each slot's WAIT, though, starts the moment its request is accepted
 * and runs on while the next slot signs in: the purge is already running on the worker, and waiting on them in turn
 * would make the step take the SUM of the purges — for the k6 tier's twenty-odd slots, minutes per run, twice per
 * run — and with a stuck worker the deadline times the slot count, which outlives the job's own timeout and ends the
 * step with no verdict naming anything. A wait polls with the slot's existing session (a re-mint, never a sign-in),
 * and it never rejects, so nothing is left unhandled while a later slot is still signing in.
 *
 * @sideEffect Signs in or re-mints, reads each slot's library, requests its purge, polls the purge, and reads again.
 */
export async function resetSlots(
    slots: readonly PoolSlot[],
    deps: SlotResetDeps,
): Promise<readonly SlotResetOutcome[]> {
    const timing = deps.purge ?? DEFAULT_PURGE_TIMING;
    const settling: Promise<SlotResetOutcome>[] = [];

    for (const slot of slots) {
        try {
            const handle = await deps.session(slot);
            const client = deps.client(handle);
            // Before the purge: the counts the log reports, and the first authenticated request of the slot.
            const world = await readWorld(client);
            const jobId = await requestPurge(client, timing);

            settling.push(
                settle(
                    {
                        slot,
                        handle,
                        client,
                        jobId,
                        before: { recipes: world.recipes.length, collections: world.collections.length },
                    },
                    timing,
                    deps.authoredFoods,
                ),
            );
        } catch (error) {
            settling.push(Promise.resolve({ slot, ok: false, reason: reasonOf(error) }));
        }
    }

    const outcomes: SlotResetOutcome[] = [];

    for (const outcome of settling) {
        outcomes.push(await outcome);
    }

    return outcomes;
}

/**
 * Await one requested purge, confirm through the owner API that it removed what the slot listed, then purge the
 * slot's authored foods.
 *
 * Foods go LAST: by then no recipe the slot owned can still reference one, so there is no window in which a recipe
 * line points at a food that is already gone.
 *
 * @sideEffect Polls the job, re-reads the slot's library, and purges its authored foods through the port.
 */
async function settle(
    purge: RequestedPurge,
    timing: PurgeTiming,
    authoredFoods: AuthoredFoodPurgePort | undefined,
): Promise<SlotResetOutcome> {
    try {
        await awaitPurge(purge.client, purge.jobId, timing);

        const after = await readWorld(purge.client);

        if (after.recipes.length > 0 || after.collections.length > 0) {
            return {
                slot: purge.slot,
                ok: false,
                reason:
                    `purge job ${purge.jobId} reported completed, but the library still lists ` +
                    `${after.recipes.length} recipes and ${after.collections.length} collections`,
            };
        }

        return {
            slot: purge.slot,
            ok: true,
            jobId: purge.jobId,
            deletedRecipes: purge.before.recipes,
            deletedCollections: purge.before.collections,
            authoredFoods: authoredFoods === undefined ? 'notPurged' : await purgeAuthoredFoods(authoredFoods, purge),
        };
    } catch (error) {
        return { slot: purge.slot, ok: false, reason: reasonOf(error) };
    }
}

/**
 * Purge one slot's authored foods, naming the half that failed.
 *
 * @sideEffect Calls food-service through the port.
 */
async function purgeAuthoredFoods(port: AuthoredFoodPurgePort, purge: RequestedPurge): Promise<number> {
    try {
        return await port.purgeOwn(purge.handle);
    } catch (error) {
        throw new Error(`recipe data purged by job ${purge.jobId}, but authored foods were not: ${reasonOf(error)}`, {
            cause: error,
        });
    }
}

/**
 * A session per slot: the stored handle if it still re-mints, else a fresh lease.
 *
 * @sideEffect The returned function re-mints (Frontend API) or leases (Backend + throttled Frontend API).
 */
export function sessionSource(input: {
    readonly handles: Readonly<Record<string, SessionHandle | undefined>>;
    readonly remint: (handle: SessionHandle) => Promise<SessionCredential>;
    readonly lease: (slot: PoolSlot) => Promise<SessionHandle>;
    readonly log: (message: string) => void;
}): (slot: PoolSlot) => Promise<SessionHandle> {
    return async (slot) => {
        const stored = input.handles[slot.id];

        if (stored !== undefined) {
            try {
                await input.remint(stored);

                return stored;
            } catch (error) {
                // Named, because an unexplained fresh sign-in is what a throttled reset looks like from outside.
                // `remintFromSession`'s messages carry no credential by construction.
                input.log(
                    `resetPool: stored session for ${slot.tier}/${slot.id} unusable, leasing — ` +
                        (error instanceof Error ? error.message : String(error)),
                );
            }
        }

        return input.lease(slot);
    };
}

/** One line per slot and a verdict. Pure. */
export function describeOutcomes(outcomes: readonly SlotResetOutcome[]): readonly string[] {
    const failed = outcomes.filter((outcome) => !outcome.ok).length;

    return [
        ...outcomes.map((outcome) =>
            outcome.ok
                ? `reset ${outcome.slot.tier}/${outcome.slot.id}: purged by job ${outcome.jobId}, ` +
                  `-${outcome.deletedRecipes} recipes, -${outcome.deletedCollections} collections, ` +
                  (outcome.authoredFoods === 'notPurged'
                      ? 'authored foods NOT purged (no food-service port passed)'
                      : `-${outcome.authoredFoods} authored foods`)
                : `FAILED ${outcome.slot.tier}/${outcome.slot.id}: ${outcome.reason}`,
        ),
        failed === 0
            ? `all ${outcomes.length} slots reset`
            : `${failed} of ${outcomes.length} slots could NOT be reset`,
    ];
}

/**
 * Read a stored-handles file; absent or unreadable is simply "none".
 *
 * @sideEffect Reads from disk.
 */
function readHandles(path: string | undefined): Readonly<Record<string, SessionHandle>> {
    if (path === undefined || !existsSync(path)) {
        return {};
    }

    try {
        return JSON.parse(readFileSync(path, 'utf8')) as Record<string, SessionHandle>;
    } catch {
        return {};
    }
}

/**
 * The CLI.
 *
 * @sideEffect Reads the environment and a handles file, calls Clerk and the recipe service (purging each slot), writes to stderr,
 *   and sets the exit code.
 */
async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const env = readSeedEnvironment(process.env);
    const foodOrigin = readFoodOrigin(process.env);
    const request = parseResetArgs(argv);
    const handlesIndex = argv.indexOf('--handles');
    const port = clerkLeasePort(env.clerkSecretKey);
    const outcomes = await resetSlots(resetTargets(request), {
        session: sessionSource({
            handles: readHandles(handlesIndex === -1 ? undefined : argv[handlesIndex + 1]),
            remint: (handle) => remintFromSession(handle),
            lease: async (slot) =>
                (
                    await leaseSession({
                        slot,
                        publishableKey: env.clerkPublishableKey,
                        origin: env.webOrigin,
                        port,
                    })
                ).handle,
            log: (message) => console.error(message),
        }),
        client: (handle) => clientFor(env.recipeOrigin, handle),
        authoredFoods: authoredFoodPurgeVia((handle) => foodClientFor(foodOrigin, handle)),
    });

    for (const line of describeOutcomes(outcomes)) {
        console.error(`e2e-seed ${line}`);
    }

    if (outcomes.some((outcome) => !outcome.ok)) {
        console.error(`::error::e2e-seed resetPool (${request.tier}): not every leased slot could be reset`);
        process.exitCode = 1;
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
