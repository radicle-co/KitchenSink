/**
 * `ensureRemoteProbeWords` — choose and verify the words the Maestro remote-food flows type, by asking the REAL
 * progressive search, as the signer, before any flow runs (owner ruling 2026-10-18).
 *
 * ## Why only the signer
 *
 * A probe is a real search and a real source call. The signer is a TEST principal, so the roots a pick of its words
 * creates are attributed and the purge can take them back (ADR-0040). A probe run as any other principal would leave
 * answers that hold roots which can never be purged. The cache needs nothing else: the shared edge keeps a found
 * answer for 7 days and an empty one for 1 (`searchResponse.ts`), keyed on the canonical term, which this client
 * builds with the same `searchTermQuerySchema` the device uses, so the flow's later search of the word costs no
 * second source call.
 *
 * ## What it does NOT do
 *
 * It makes no source call per flow: provision runs it once, and the per-flow reset never does.
 *
 * @pattern Adapter — `ProbeSearchPort` over `FoodServiceClient.searchProgressive`, folded with the client's own
 *   `withProgressiveFrame`; the decisions are the pure `planNextProbe`.
 * @module
 */
import {
    EMPTY_PROGRESSIVE_ANSWER,
    isFetchUnavailableError,
    isRateLimitedError,
    withProgressiveFrame,
} from '@kitchensink/food-service-client';
import type { FoodServiceClient, ProgressiveAnswer } from '@kitchensink/food-service-client';

import { RemoteProbeExhaustedError } from './remoteProbeExhaustedError.js';
import {
    observationOf,
    planNextProbe,
    rejectionsOf,
    type ObservedProbes,
    type ProbeCandidates,
    type ProbeObservation,
    type ProbeRole,
    type ProvisionedProbeWords,
} from './remoteProbeWords.js';

/** The most searches a provision spends on probe words, retries included. A word that needs more has failed. */
export const MAX_PROBE_SEARCHES = 10;

/** The longest one wait on a `retryAt`, in milliseconds. A source that asks for more is treated as unreachable. */
export const MAX_RETRY_WAIT_MS = 60_000;

/** The wait when a refusal names none, in milliseconds. */
export const DEFAULT_RETRY_WAIT_MS = 5_000;

/** What the probe needs of the food service. */
export interface ProbeSearchPort {
    /**
     * One progressive search of a term, folded into what the probe judges. A refusal that says "try later" is a
     * transient observation, not a throw.
     *
     * @sideEffect Performs a request that can make a source call.
     */
    search(term: string): Promise<ProbeObservation>;
    /**
     * The names of the caller's own foods a term finds. Makes no source call.
     *
     * @sideEffect Performs a request.
     */
    authoredNames(term: string): Promise<readonly string[]>;
}

/** The seams of {@link ensureRemoteProbeWords}. */
export interface EnsureRemoteProbeWordsDeps {
    readonly port: ProbeSearchPort;
    /** Epoch milliseconds. */
    readonly now: () => number;
    readonly sleep: (milliseconds: number) => Promise<void>;
    /** Author the signer's own food, by exact name; idempotent. */
    readonly authorFood: (name: string) => Promise<unknown>;
    /** A line for the operator: stderr in provision. */
    readonly log: (line: string) => void;
}

/**
 * The port over a food-service client.
 *
 * `searchProgressive` canonicalises the term itself (`searchTermQuerySchema`) and throws before a request when it is
 * not a legal term, so the cache key is the device's by construction.
 *
 * @param food - A client authenticated as the signer.
 * @param now - The clock a `retryAfterSeconds` is read against.
 * @returns The port.
 */
export function probePortOver(
    food: Pick<FoodServiceClient, 'searchProgressive' | 'searchAuthored'>,
    now: () => number,
): ProbeSearchPort {
    return {
        async search(term) {
            try {
                let answer: ProgressiveAnswer = EMPTY_PROGRESSIVE_ANSWER;

                for await (const frame of food.searchProgressive(term)) {
                    answer = withProgressiveFrame(answer, frame);
                }

                return observationOf(answer);
            } catch (error) {
                // Two layers say "later": a hold the client keeps itself (nothing was sent), and a refusal before the
                // first byte. Neither says anything about the WORD. A caller's own limit (search or source budget)
                // is the same: wait it out within the search budget.
                if (isRateLimitedError(error)) {
                    return {
                        kind: 'transient',
                        cause: 'limited',
                        retryAt: now() + secondsToMs(error.retryAfterSeconds),
                    };
                }

                if (isFetchUnavailableError(error)) {
                    return {
                        kind: 'transient',
                        cause: 'unavailable',
                        retryAt: now() + secondsToMs(error.retryAfterSeconds),
                    };
                }

                throw error;
            }
        },
        async authoredNames(term) {
            return (await food.searchAuthored(term)).results.flatMap((result) =>
                result.name === null ? [] : [result.name],
            );
        },
    };
}

function secondsToMs(seconds: number | undefined): number {
    return seconds === undefined ? DEFAULT_RETRY_WAIT_MS : seconds * 1_000;
}

/**
 * Choose and verify the probe words, then author the append story's own food.
 *
 * @param deps - The seams.
 * @param input - The candidates, the run key, and the stage's name for an error.
 * @returns The words the manifest carries.
 * @throws {RemoteProbeExhaustedError} when a role has no candidate left, or the {@link MAX_PROBE_SEARCHES} budget runs
 *   out. It is the provision failure the ruling asks for.
 * @throws {Error} when the authored food is not found by its own search afterwards.
 * @sideEffect Searches the real catalog and USDA as the signer (up to {@link MAX_PROBE_SEARCHES} times), waits on
 *   `retryAt`, writes one authored food, and logs.
 */
export async function ensureRemoteProbeWords(
    deps: EnsureRemoteProbeWordsDeps,
    input: { readonly candidates: ProbeCandidates; readonly runKey: string; readonly stage: string },
): Promise<ProvisionedProbeWords> {
    const { candidates, runKey, stage } = input;
    const observed: Record<ProbeRole, Record<string, ProbeObservation>> = {
        append: {},
        change: {},
        unresolved: {},
        noMatch: {},
    };
    let searches = 0;

    for (;;) {
        const plan = planNextProbe(candidates, observed);

        if (plan.kind === 'exhausted') {
            throw new RemoteProbeExhaustedError(plan.role, plan.rejections, stage);
        }

        if (plan.kind === 'chosen') {
            return await finish(deps, { candidates, observed, words: plan.words, runKey });
        }

        if (searches >= MAX_PROBE_SEARCHES) {
            throw new RemoteProbeExhaustedError(
                plan.role,
                rejectionsOf(candidates, observed, plan.role),
                stage,
                'search-budget',
            );
        }

        const last = observed[plan.role][plan.term];

        if (last?.kind === 'transient') {
            const wait = (last.retryAt ?? deps.now() + DEFAULT_RETRY_WAIT_MS) - deps.now();

            deps.log(
                `e2e-seed probe: "${plan.term}" got ${last.cause}; asking again in ${String(Math.max(wait, 0))} ms`,
            );
            await deps.sleep(Math.min(Math.max(wait, 0), MAX_RETRY_WAIT_MS));
        }

        searches += 1;
        observed[plan.role][plan.term] = await deps.port.search(plan.term);
    }
}

/** Warn about every fallback, author the append food and confirm it, and name the words. */
async function finish(
    deps: EnsureRemoteProbeWordsDeps,
    input: {
        readonly candidates: ProbeCandidates;
        readonly observed: ObservedProbes;
        readonly words: Readonly<Record<ProbeRole, string>>;
        readonly runKey: string;
    },
): Promise<ProvisionedProbeWords> {
    const { candidates, observed, words, runKey } = input;

    for (const role of ['append', 'change'] as const) {
        if (words[role] !== candidates[role][0]) {
            const dropped = rejectionsOf(candidates, observed, role)
                .map((each) => `${each.word} (${each.reason})`)
                .join(', ');

            deps.log(`::warning::e2e-seed probe: the ${role} word fell back to "${words[role]}"; rejected: ${dropped}`);
        }
    }

    const appendFood = `${words.append} ${runKey}`;

    await deps.authorFood(appendFood);

    // Confirmed with the authored search, which makes no source call: the story expects this food listed.
    const found = await deps.port.authoredNames(words.append);

    if (!found.some((name) => name === appendFood)) {
        throw new Error(`e2e-seed probe: authored food "${appendFood}" is not found by its own search`);
    }

    return {
        appendWord: words.append,
        appendFood,
        changeWord: words.change,
        unresolvedWord: words.unresolved,
        noMatchFood: words.noMatch,
    };
}
