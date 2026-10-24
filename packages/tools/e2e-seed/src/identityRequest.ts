/**
 * ONE way for the seeder to call the identity service: a bounded, retried HTTPS request that tells a stage still
 * waking up (retry) from identity's own answer (final).
 *
 * Both callers needed the same rules — the entitlement READ before `provision` seeds, and the settings RESET
 * (ADR-0059) — and `client.ts` states the house rule that the seeder answers "how do I talk to a service" once.
 *
 * ⛔ The classification is the point. A `408`/`429`/`5xx`, a connection that never completed and a body cut short are
 * the stage failing to finish, so they are retried. Every other non-2xx is identity's ANSWER, and asking again would
 * only hide it behind a loop: a `404` from a server that predates a route, a `401`, a `403`.
 *
 * @pattern Template Method — the retry/classification skeleton is fixed here; the caller supplies what to do with a
 *   successful response (`onOk`)
 */
import pRetry, { AbortError } from 'p-retry';

import { withoutTrailingSlashes } from './env.js';
import { IdentityRefusedError } from './identityRefusedError.js';
import { isTransientStatus } from './transientStatus.js';

/** How a request rides out a cold identity task. */
export interface IdentityRetry {
    readonly retries: number;
    readonly intervalMs: number;
    /** Bounds ONE attempt: a server that accepts and never answers would otherwise hold it for minutes. */
    readonly attemptDeadlineMs: number;
}

/** Injected so the unit tier needs no network and no timers. */
export interface IdentityDeps {
    readonly fetch?: typeof globalThis.fetch;
    readonly retry?: IdentityRetry;
}

/**
 * Three retries, two seconds apart, each attempt bounded at 15 s (the house figure, `deployedSmoke.ts`): the calls
 * made through here are idempotent, and the only thing to wait for is a task to wake.
 */
export const DEFAULT_IDENTITY_RETRY: IdentityRetry = { retries: 3, intervalMs: 2_000, attemptDeadlineMs: 15_000 };

/** A failure the stage recovers from on its own. Anything else is identity's answer and is final. */
class TransientIdentityFailure extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'TransientIdentityFailure';
        Object.setPrototypeOf(this, TransientIdentityFailure.prototype);
    }
}

/** One request to identity. */
export interface IdentityRequest<T> {
    readonly identityOrigin: string;
    /** The path, beginning with `/`. */
    readonly path: string;
    readonly method: 'GET' | 'DELETE';
    /** Who is asking, for the message: `"<METHOD> <url> as <description>"`. */
    readonly asDescription: string;
    readonly token: () => Promise<string>;
    /** What to make of a 2xx. A body read that fails with a `SyntaxError` is final; any other failure is retried. */
    readonly onOk: (response: Response, describe: string) => Promise<T>;
}

/**
 * Call identity, riding out a cold task.
 *
 * @param request - What to call and what to do with the answer.
 * @param deps - `fetch` and the retry bound.
 * @returns Whatever `onOk` returns.
 * @throws IdentityRefusedError When identity refuses the call finally (it carries the status).
 * @throws Error When identity stays unavailable past the bound.
 * @sideEffect Mints a token and makes one or more HTTPS requests against identity.
 */
export async function requestIdentity<T>(request: IdentityRequest<T>, deps: IdentityDeps): Promise<T> {
    const fetch = deps.fetch ?? globalThis.fetch;
    const retry = deps.retry ?? DEFAULT_IDENTITY_RETRY;
    const url = `${withoutTrailingSlashes(request.identityOrigin)}${request.path}`;
    const describe = `${request.method} ${url} as ${request.asDescription}`;

    return pRetry(
        async () => {
            let response: Response;

            try {
                response = await fetch(url, {
                    method: request.method,
                    headers: { Authorization: `Bearer ${await request.token()}` },
                    signal: AbortSignal.timeout(retry.attemptDeadlineMs),
                });
            } catch (error) {
                throw new TransientIdentityFailure(
                    `${describe} did not complete (${error instanceof Error ? error.message : String(error)})`,
                );
            }

            if (!response.ok) {
                const message = `${describe} answered ${response.status}`;

                // p-retry rethrows an AbortError's original error, so the caller receives the typed refusal.
                throw isTransientStatus(response.status)
                    ? new TransientIdentityFailure(message)
                    : new AbortError(new IdentityRefusedError(message, response.status));
            }

            try {
                return await request.onOk(response, describe);
            } catch (error) {
                // Only a body that ARRIVED WHOLE and does not parse is final (`SyntaxError`). Any other failure of the
                // read — the attempt deadline, or undici's `TypeError: terminated` when the stream is cut — is the
                // stage failing to finish, like a fetch that never completed, so it is retried.
                if (error instanceof AbortError || error instanceof TransientIdentityFailure) {
                    throw error;
                }

                throw error instanceof SyntaxError
                    ? new AbortError(`${describe} answered ${response.status} with a body that is not JSON`)
                    : new TransientIdentityFailure(
                          `${describe} did not finish its body (${error instanceof Error ? error.message : String(error)})`,
                      );
            }
        },
        {
            retries: retry.retries,
            minTimeout: retry.intervalMs,
            maxTimeout: retry.intervalMs,
            shouldRetry: ({ error }) => error instanceof TransientIdentityFailure,
        },
    );
}
