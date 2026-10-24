/**
 * The bounded replay of a request a service refused for its bearer, shared by the food, recipe and profile clients.
 *
 * A `401` means the service processed nothing, so sending the request again is safe for a write too. Only a different
 * bearer can change the answer, so a request is sent again only when a mint asked to skip its cache yields a token
 * other than the one refused. A literal bearer, or a callback that answers the refused token again (a forwarded
 * bearer, or none while the session loads), is never replayed.
 *
 * - **An ordinary refusal** is replayed once.
 * - **`IDENTITY_SYNC_PENDING`** (the token carries no app-user id yet, because identity has not written it back to
 *   Clerk) is replayed after a back-off, a few times, because only a token minted after that write can carry it. The
 *   recipe and food services send the same code for this, so the back-off is one rule here, not one per client.
 *
 * Each client says what an attempt means ({@link BearerVerdict}) by reading its own published error schema, and keeps
 * its own transport. An attempt reaches this module settled: a refused one's body is already read or released, so
 * nothing stays open across the mint, the wait or the replay, and an answered one is handed back unread and unchanged.
 *
 * In this package because it is the clients' one shared, platform-free module about when a request may be sent
 * again; `./retryAfter.ts` is the other half of that question.
 *
 * @pattern Retry — bounded, with each client's reading of a response injected as a Strategy
 * @module
 */

/**
 * A bearer token supplied either as a literal or a (sync or async) per-request callback. After a refusal the callback
 * is asked again with `{ forceRefresh: true }` and must then mint afresh rather than answer from a cache (the apps wire
 * it to Clerk's `getToken({ skipCache })`). A callback that ignores the argument still works; its refusals are simply
 * never replayed.
 */
export type TokenSource = string | ((options?: { readonly forceRefresh?: boolean }) => string | Promise<string>);

/**
 * What one attempt means for its bearer.
 *
 * - `answered`: anything but a bearer refusal. It is the answer.
 * - `refused`: a `401`. A different bearer may change it.
 * - `identitySyncPending`: a `401` whose code is `IDENTITY_SYNC_PENDING`. A bearer minted later may change it.
 */
export type BearerVerdict = 'answered' | 'refused' | 'identitySyncPending';

/** How long and how often an `IDENTITY_SYNC_PENDING` refusal is waited out. A client's options extend this. */
export interface IdentitySyncBackoffOptions {
    /**
     * The most replays of an `IDENTITY_SYNC_PENDING` refusal, each after a back-off and with a fresh mint. Default
     * `3`; `0` disables. An ordinary refusal's one replay is not counted here.
     */
    readonly maxIdentitySyncRetries?: number;
    /**
     * The wait (ms) before the Nth replay (1-based); the last entry repeats when there are more replays than entries.
     * Default `[250, 500, 1000]`, which gives identity's webhook time to write the app-user id back to Clerk.
     */
    readonly identitySyncBackoffMs?: readonly number[];
    /**
     * Waits `ms`, ending early when `signal` aborts. Defaults to a timer. Injectable so a test waits no time.
     *
     * @sideEffect Waits.
     */
    readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** One request to send, and how to read what it answers. */
export interface BearerReplay<A> {
    /** The bearer, or `undefined` for an unauthenticated request. */
    readonly token: TokenSource | undefined;
    /**
     * Sends the request once with `bearer`, and settles it: a refused attempt's body is read or released before it is
     * returned.
     *
     * @sideEffect Performs one request.
     */
    readonly send: (bearer: string | undefined) => Promise<A>;
    /** What an attempt means for its bearer, read from the client's own error schema. Pure. */
    readonly verdictOf: (attempt: A) => BearerVerdict;
    /** Asks the first mint to skip its cache too, for a caller that wants a fresh token from the start. */
    readonly forceRefreshFirst?: boolean | undefined;
    /** The `IDENTITY_SYNC_PENDING` back-off. */
    readonly backoff?: IdentitySyncBackoffOptions | undefined;
    /** The caller's signal. Once it aborts, the last attempt is the answer: nothing is waited, minted or sent again. */
    readonly signal?: AbortSignal | undefined;
}

/** The default most replays of an `IDENTITY_SYNC_PENDING` refusal. */
const DEFAULT_IDENTITY_SYNC_RETRIES = 3;

/** The default back-off before each `IDENTITY_SYNC_PENDING` replay, in milliseconds. */
const DEFAULT_IDENTITY_SYNC_BACKOFF_MS: readonly number[] = [250, 500, 1000];

/** The replays one request has spent. */
interface ReplayBudget {
    readonly identitySyncRetries: number;
    readonly refusalReplayed: boolean;
}

/** The back-off settings, defaults applied. */
interface ReplayPolicy {
    readonly maxIdentitySyncRetries: number;
    readonly identitySyncBackoffMs: readonly number[];
}

/** Whether to send again, and after how long. */
type ReplayStep =
    { readonly kind: 'stop' } | { readonly kind: 'replay'; readonly waitMs: number; readonly budget: ReplayBudget };

const UNSPENT: ReplayBudget = { identitySyncRetries: 0, refusalReplayed: false };

/**
 * Wait `ms`, ending early when `signal` aborts. Platform-free: `node:timers/promises` takes a signal, but the apps'
 * runtimes have no such module.
 *
 * @param ms - The wait.
 * @param signal - The caller's signal.
 * @returns When the wait ends.
 * @sideEffect Arms a timer.
 */
function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted === true) {
            resolve();

            return;
        }

        const end = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', end);
            resolve();
        };

        const timer = setTimeout(end, ms);

        signal?.addEventListener('abort', end, { once: true });
    });
}

/**
 * Whether an attempt is sent again, and after how long. Pure.
 *
 * @param verdict - What the last attempt means for its bearer.
 * @param budget - The replays already spent.
 * @param policy - The back-off settings.
 * @returns The step.
 */
function nextStep(verdict: BearerVerdict, budget: ReplayBudget, policy: ReplayPolicy): ReplayStep {
    switch (verdict) {
        case 'answered':
            return { kind: 'stop' };
        case 'refused':
            return budget.refusalReplayed
                ? { kind: 'stop' }
                : { kind: 'replay', waitMs: 0, budget: { ...budget, refusalReplayed: true } };

        case 'identitySyncPending': {
            const retry = budget.identitySyncRetries + 1;

            // Written as "not within", so a retry count that is not a number replays nothing.
            if (!(retry <= policy.maxIdentitySyncRetries)) {
                return { kind: 'stop' };
            }

            const waits = policy.identitySyncBackoffMs;

            return {
                kind: 'replay',
                waitMs: waits[Math.min(retry, waits.length) - 1] ?? 0,
                budget: { ...budget, identitySyncRetries: retry },
            };
        }
    }
}

/**
 * The bearer a token source gives, or `undefined` for none.
 *
 * @param token - The source.
 * @param forceRefresh - Passed to a callback, which then mints afresh.
 * @returns The bearer.
 * @sideEffect Calls the token callback, which may read or refresh the session.
 */
export async function resolveBearer(
    token: TokenSource | undefined,
    forceRefresh: boolean,
): Promise<string | undefined> {
    if (token === undefined) {
        return undefined;
    }

    return typeof token === 'function' ? token({ forceRefresh }) : token;
}

/**
 * Send a request, and send it again after a refusal of its bearer, as this module's rules allow.
 *
 * @param replay - The request, its bearer and how to read an attempt.
 * @returns The last attempt, unchanged: the replay's when there was one, whatever it answered.
 * @throws Whatever `send` or the token callback throws, unchanged; nothing is sent after it.
 * @sideEffect Sends the request up to `2 + maxIdentitySyncRetries` times, calls the token callback and waits.
 */
export async function withBearerReplay<A>(replay: BearerReplay<A>): Promise<A> {
    const { token, send, verdictOf, signal } = replay;
    const policy: ReplayPolicy = {
        maxIdentitySyncRetries: replay.backoff?.maxIdentitySyncRetries ?? DEFAULT_IDENTITY_SYNC_RETRIES,
        identitySyncBackoffMs: replay.backoff?.identitySyncBackoffMs ?? DEFAULT_IDENTITY_SYNC_BACKOFF_MS,
    };
    const sleep = replay.backoff?.sleep ?? sleepUnlessAborted;
    // A function, not a read: the caller's signal can abort while this waits.
    const callerStopped = (): boolean => signal?.aborted === true;

    let bearer = await resolveBearer(token, replay.forceRefreshFirst ?? false);
    let attempt = await send(bearer);
    let budget = UNSPENT;

    for (;;) {
        // A literal bearer, or none, cannot be minted again, so no replay could change the answer.
        if (typeof token !== 'function' || callerStopped()) {
            return attempt;
        }

        const step = nextStep(verdictOf(attempt), budget, policy);

        if (step.kind === 'stop') {
            return attempt;
        }

        if (step.waitMs > 0) {
            await sleep(step.waitMs, signal);

            if (callerStopped()) {
                return attempt;
            }
        }

        const fresh = await token({ forceRefresh: true });

        if (fresh === bearer) {
            return attempt;
        }

        bearer = fresh;
        budget = step.budget;
        attempt = await send(bearer);
    }
}
