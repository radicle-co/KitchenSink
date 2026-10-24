/**
 * The seed tool's ONE transport seam for its service clients: a `fetch` that repeats an IDEMPOTENT request when the
 * stage blips, and repeats nothing else.
 *
 * Why it exists: `reset` runs once per shard and a Maestro run starts 13 shards at the same moment against ONE recipe
 * task. A gateway `502` in front of that task stopped a whole shard before its first flow, although the task itself
 * logged nothing and never restarted. A gateway answering 502/503/504 is the stage recovering, and a GET repeats
 * safely.
 *
 * @pattern Decorator over `fetch` — injected through the clients' own `fetch` option, so no client package changes
 *   and no call site chooses whether to retry.
 *
 * ⚠️ Scope is deliberately small:
 * - Only `GET` and `HEAD`. A write is never repeated here; the one write that is safe to repeat, an authored-food
 *   create (food dedups by name), keeps its own bounded retry in `recipeWorld.ts`, so nothing is retried twice.
 * - Only 502, 503, 504 and a thrown network error. `429` and `500` are the service's answer, not a gateway blip, and
 *   stay with the callers that already decide on them (`isTransientStatus`).
 * - A request that its own deadline or caller aborted is not repeated: repeating it would outlast the bound.
 */
import { setTimeout as delay } from 'node:timers/promises';

import pRetry from 'p-retry';

import { retryAfterSeconds } from '@kitchensink/retry-after';

/** The methods a repeat cannot change the outcome of. */
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** The gateway statuses that mean "the thing behind me is not answering right now". */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Tuning for {@link idempotentRetryFetch}. Every field is optional; tests inject the delays. */
export interface IdempotentRetryOptions {
    /** The `fetch` to wrap. Defaults to the global one. */
    readonly base?: typeof fetch;
    /** Repeats after the first attempt, so `4` is five attempts. */
    readonly retries?: number;
    /** First backoff, doubled per attempt with jitter. */
    readonly minTimeoutMs?: number;
    /** Ceiling of one backoff. */
    readonly maxTimeoutMs?: number;
    /** Ceiling of a `Retry-After` wait, so a hostile or mistaken hint cannot stall a shard. */
    readonly maxRetryAfterMs?: number;
    /** How the `Retry-After` remainder is waited out. */
    readonly sleep?: (ms: number) => Promise<void>;
}

/** Five attempts; worst case 0.5+1+2+4 s of backoff (doubled by jitter at most) plus Retry-After capped at 5 s each. */
const DEFAULTS = { retries: 4, minTimeoutMs: 500, maxTimeoutMs: 8_000, maxRetryAfterMs: 5_000 } as const;

/** A gateway answer, carried through p-retry so the last one can be handed back to the client unread. */
class GatewayBlip extends Error {
    public constructor(public readonly response: Response) {
        super(`gateway answered ${response.status}`);
        Object.setPrototypeOf(this, GatewayBlip.prototype);
    }
}

function isGatewayBlip(error: unknown): error is GatewayBlip {
    return error instanceof GatewayBlip;
}

/**
 * The method and abort signal a call carries, whichever of the two `fetch` shapes it uses. Pure.
 *
 * @param input - First argument of `fetch`.
 * @param init - Second argument of `fetch`.
 * @returns The upper-cased method and the signal, if any.
 */
function describeCall(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
): { method: string; signal?: AbortSignal | null } {
    const carried = input instanceof Request ? input : undefined;

    return {
        method: (init?.method ?? carried?.method ?? 'GET').toUpperCase(),
        signal: init?.signal ?? carried?.signal,
    };
}

/**
 * Wraps `fetch` so GET and HEAD requests survive a gateway blip. Anything else passes straight through.
 *
 * @param options - See {@link IdempotentRetryOptions}.
 * @returns A drop-in `fetch`. A GET that stays on 502/503/504 resolves with the LAST such response, so the client
 *   classifies it exactly as it would have without the wrapper; a network failure that outlasts the bound rethrows.
 * @sideEffect Performs HTTP requests through `options.base` and sleeps between attempts.
 */
export function idempotentRetryFetch(options: IdempotentRetryOptions = {}): typeof fetch {
    const base = options.base ?? globalThis.fetch.bind(globalThis);
    const { retries, minTimeoutMs, maxTimeoutMs, maxRetryAfterMs } = { ...DEFAULTS, ...stripUndefined(options) };
    const sleep = options.sleep ?? ((ms: number): Promise<void> => delay(ms));

    return async (input, init) => {
        const { method, signal } = describeCall(input, init);

        if (!IDEMPOTENT_METHODS.has(method)) {
            return base(input, init);
        }

        // A Request is single-use only when it has a body; a GET has none, but clone per attempt anyway so a
        // wrapped Request is never the thing that fails on the second try.
        const attempt = async (): Promise<Response> => {
            const response = await base(input instanceof Request ? input.clone() : input, init);

            if (GATEWAY_STATUSES.has(response.status)) {
                throw new GatewayBlip(response);
            }

            return response;
        };

        try {
            return await pRetry(attempt, {
                retries,
                minTimeout: minTimeoutMs,
                maxTimeout: maxTimeoutMs,
                shouldRetry: () => signal?.aborted !== true,
                onFailedAttempt: async ({ error, retryDelay }) => {
                    if (!isGatewayBlip(error)) {
                        return;
                    }

                    // The superseded answer's body is never read; free its socket.
                    void error.response.body?.cancel().catch(() => undefined);

                    const hintSeconds = retryAfterSeconds(error.response.headers.get('retry-after'), Date.now());
                    const hintMs = Number.isFinite(hintSeconds) ? (hintSeconds ?? 0) * 1_000 : 0;
                    // p-retry sleeps `retryDelay` itself; only the part of the hint it does not already cover is added.
                    const extraMs = Math.min(hintMs, maxRetryAfterMs) - retryDelay;

                    if (extraMs > 0) {
                        await sleep(extraMs);
                    }
                },
            });
        } catch (error) {
            if (isGatewayBlip(error)) {
                return error.response;
            }

            throw error;
        }
    };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
