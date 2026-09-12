/**
 * A Clerk Frontend-API session, established ONCE and re-minted from cheaply.
 *
 * ## Why the session is held, rather than signing in again
 *
 * A deployed Maestro run needs a fresh bearer roughly thirty-five times — once per per-flow fixture reset —
 * and a Clerk session token lives about a minute, so "sign in again" means thirty-five SIGN-INS, and sign-in
 * is the rate-limited half. Minting a token FROM an existing session is a different endpoint and is not
 * limited. So the sign-in happens once, its handle is kept, and every later bearer comes from
 * `POST /client/sessions/{id}/tokens` — the shape a real browser uses.
 *
 * ## Why the sign-in is a TICKET (measured 2026-09-13, sandbox instance, one IP)
 *
 * This used to sign in with the email-code factor (`sign_ins` → `prepare_first_factor` →
 * `attempt_first_factor`, fixed dev code). The deployed k6 pool died on it in three runs of four, always on
 * the VERIFICATION steps (`too_many_requests`, or `verification_not_sent` when an unread, refused prepare was
 * followed by an attempt) while every create succeeded. Replaying the pool's exact shape reproduced that: the
 * verification calls were refused from the fourth identity on with `Retry-After` ~60 s, and the same twelve
 * identities at the same pace signed in 12/12 by ticket. The verification counter's window and scope are NOT
 * known — a CI run once got twelve through — which is exactly why the fix is to stop spending it rather than to
 * pace it.
 *
 * A ticket (Backend API `sign_in_tokens`, then ONE Frontend API `sign_ins` with `strategy=ticket`) completes in
 * a single call, and the session it creates stamps `azp` from `Origin` exactly as the email-code one did —
 * measured, for both the stage origin and `https://unauthorized.invalid`, and `public_metadata.scopes` is
 * carried as before.
 *
 * ⛔ Not the Backend API's `POST /sessions` shortcut: that token carries NO `azp`, and an `azp`-less token is
 * admitted only by the native-client gate — measured `401` from both recipe and food on a live `pr-{N}`.
 *
 * ## Why `Origin` is on every call
 *
 * Clerk stamps the request `Origin` into the token as `azp`, and `azp` is what `CLERK_AZP_PATTERN` on the
 * deployed services is anchored against (ADR-0033). A re-mint that dropped it would return a token the
 * services refuse, and the refusal arrives as an opaque `401` from a service rather than as an error here.
 * {@link assertAzp} therefore checks the claim at the point it is produced.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError, type ClerkAPIResponseError } from '@clerk/backend/errors';
import pRetry from 'p-retry';

import { assertPoolMember } from './testPool.js';

/**
 * The pause after every sign-in create.
 *
 * Clerk publishes 5 sign-in creates per 10 s per IP, and exceeding it was measured to cost `Retry-After: 600` —
 * a ten-minute ban. Holding this long AFTER each create keeps any two creates at least this far apart, which
 * holds any 10 s window to four. It is held after the create rather than before the next one so that two
 * processes run back to back (the pool, then `e2e-seed provision`, in one CI step) are spaced too: the pause
 * lives in the process that made the create.
 *
 * ⛔ IN-PROCESS, THE GUARANTEE DOES NOT DEPEND ON THE CALLER. `establishSession` serializes its own sign-ins
 * on a module-level queue and holds the queue through this pause, so two concurrent calls in one process
 * cannot put their creates inside one window — the spacing used to be true only because every caller happened
 * to `await` one at a time. A REFUSED create still counted against Clerk's window, so it leaves the NEXT
 * sign-in owing this pause (the refused caller itself still throws at once — see {@link establishSession}).
 * ⚠️ Across processes the pause-after-create is what spaces back-to-back invocations; two processes run in
 * PARALLEL from one IP are outside anything this module can see.
 */
export const SIGN_IN_CREATE_GAP_MS = 3_000;

/** How long a minted ticket stays valid. It is spent within a second; an unused one is a live credential. */
export const TICKET_LIFETIME_SECONDS = 60;

/** Backend API 429 retries for a CI session — that limit is instance-wide and shared with every concurrent suite. */
export const BACKEND_RETRIES = 3;

/** The longest Backend API 429 wait a CI session sits through before it fails instead. */
export const BACKEND_MAX_WAIT_SECONDS = 10;

/** How a caller waits out the Backend API's rate limit. */
export interface ClerkBackendRetryOptions {
    /** 429s this caller retries before it rethrows the last one. */
    readonly retries: number;
    /** A stated retry-after beyond this fails at once, and it caps the doubling fallback. */
    readonly maxWaitSeconds: number;
    /** Injected for tests; defaults to a real timer. */
    readonly sleep?: (ms: number) => Promise<unknown>;
}

const isRateLimited = (error: unknown): error is ClerkAPIResponseError =>
    isClerkAPIResponseError(error) && error.status === 429;

/**
 * A failure where no status reached the SDK: `@clerk/backend` maps a thrown `fetch` (and an answered body it cannot parse)
 * to a `ClerkAPIResponseError` with no status and only `unexpected_error` codes (measured in CI run 34856885723, where one
 * such failure sank a shard's setup). The server MAY still have acted before the connection dropped, so a retried
 * create can meet its own first write: `poolAdmin`'s `createUser` then fails loudly with Clerk's duplicate-address
 * `422`, never silently creating a second user.
 */
const isTransportFailure = (error: unknown): error is ClerkAPIResponseError =>
    isClerkAPIResponseError(error) &&
    !Number.isInteger(error.status) &&
    error.errors.length > 0 &&
    error.errors.every((entry) => entry.code === 'unexpected_error');

/**
 * Run one Backend API call, waiting out the instance-wide rate limit the way Clerk asks: the `Retry-After` it states
 * (whole seconds), or a doubling wait from two seconds when it states none, capped at the caller's maximum. A `429` and
 * a transport failure (no status reached the SDK) are retried; every answered refusal is final. A stated wait longer than the caller can afford rethrows at once, because retrying before Clerk
 * said it would answer only spends the budget.
 *
 * @sideEffect Calls `call` and sleeps between attempts.
 */
export function withClerkBackendRetry<T>(
    call: () => Promise<T>,
    { retries, maxWaitSeconds, sleep = delay }: ClerkBackendRetryOptions,
): Promise<T> {
    return pRetry(call, {
        retries,
        minTimeout: 0,
        randomize: false,
        shouldRetry: ({ error }) =>
            isTransportFailure(error) || (isRateLimited(error) && (error.retryAfter ?? 0) <= maxWaitSeconds),
        onFailedAttempt: async ({ error, attemptNumber, retriesLeft }) => {
            const retryable = isRateLimited(error) || isTransportFailure(error);
            const stated = isRateLimited(error) ? error.retryAfter : undefined;

            if (!retryable || retriesLeft === 0 || (stated ?? 0) > maxWaitSeconds) {
                return;
            }

            await sleep((stated ?? Math.min(2 ** attemptNumber, maxWaitSeconds)) * 1000);
        },
    });
}

/** What a minted credential carries. */
export interface SessionCredential {
    /** The Clerk-signed bearer. */
    readonly token: string;
    /** The `azp` it carries — must satisfy the deployed services' `CLERK_AZP_PATTERN`. */
    readonly azp: string;
    /** The Clerk subject. */
    readonly sub: string;
}

/**
 * Everything needed to mint another token without signing in again.
 *
 * ⚠️ This is a CREDENTIAL. It is written to disk so ~35 separate reset processes can share one sign-in;
 * `sessionState.ts` in the seeder owns that file and creates it `0600`. Never log it.
 */
export interface SessionHandle {
    /** The Clerk session id. */
    readonly sessionId: string;
    /** The dev-browser JWT the FAPI handshake issued; every later call carries it. */
    readonly devJwt: string;
    /** The instance's Frontend API base, e.g. `https://x.clerk.accounts.dev/v1`. */
    readonly fapi: string;
    /** The origin Clerk stamps as `azp`. */
    readonly origin: string;
    /** The address this session belongs to — carried for diagnostics, never for a decision. */
    readonly email: string;
}

/** Injectable `fetch`, so the retry and handshake logic is testable without a Clerk instance. */
export type FetchLike = typeof globalThis.fetch;

/**
 * The instance's Frontend API host, decoded from the publishable key (`pk_test_<base64url("host$")>`)
 * rather than configured separately, so the FAPI host and the verifying instance cannot drift. Pure.
 */
export const fapiHostFromPublishableKey = (publishableKey: string): string =>
    Buffer.from(publishableKey.split('_').slice(2).join('_'), 'base64').toString('utf8').replace(/\$$/, '');

/** The claims a session token carries that anything here cares about. Pure. */
export function decodeClaims(token: string): { readonly azp?: string; readonly sub?: string } {
    const payload = token.split('.')[1] ?? '';

    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString()) as { azp?: string; sub?: string };
    } catch {
        return {};
    }
}

/**
 * Refuse a token whose `azp` is not the origin we asked for.
 *
 * The check lives HERE, where the failure is legible, because without it the caller fails later as an
 * opaque `401` from a service — which is what cost the original diagnosis a whole investigation. Pure.
 */
export function assertAzp(token: string, origin: string): SessionCredential {
    const claims = decodeClaims(token);

    if (claims.azp !== origin) {
        throw new Error(`minted token carries azp=${String(claims.azp)}, expected ${origin}`);
    }

    return { token, azp: origin, sub: claims.sub ?? '' };
}

const asJson = async (response: Response): Promise<Record<string, unknown>> => {
    const text = await response.text();

    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return { raw: text };
    }
};

/**
 * Refuse a production instance. The tooling holds the instance's secret key, and a ticket signs in any user,
 * so nothing but this stops a mis-set key from signing into production. Pure.
 */
function assertDevelopmentInstance(publishableKey: string): void {
    if (!publishableKey.startsWith('pk_test_')) {
        throw new Error('the publishable key is not a development instance key — test sessions are never minted there');
    }
}

/** Mints a single-use sign-in ticket for the Clerk user holding `email` — the Backend API half of a sign-in. */
export type TicketMinter = (email: string) => Promise<string>;

/**
 * A {@link TicketMinter} over the Backend API: finds the ONE user holding the address and mints a ticket that
 * expires in {@link TICKET_LIFETIME_SECONDS}. A 429 is waited out through {@link withClerkBackendRetry}, because
 * that limit is shared across the instance and recovers in seconds; anything else is final.
 *
 * @sideEffect The returned function calls the Clerk Backend API.
 */
export function ticketMinterFor(secretKey: string): TicketMinter {
    const clerk = createClerkClient({ secretKey });
    const backend = <T>(call: () => Promise<T>): Promise<T> =>
        withClerkBackendRetry(call, { retries: BACKEND_RETRIES, maxWaitSeconds: BACKEND_MAX_WAIT_SECONDS });

    return async (email) => {
        const { data: users } = await backend(() => clerk.users.getUserList({ emailAddress: [email] }));
        const [user, ...others] = users;

        if (user === undefined || others.length > 0) {
            throw new Error(`expected exactly one Clerk user holding ${email}, found ${users.length}`);
        }

        const { token } = await backend(() =>
            clerk.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: TICKET_LIFETIME_SECONDS }),
        );

        return token;
    };
}

/**
 * How a refused Clerk step reads in a log: the step, WHOSE step it was, the status, `Retry-After` and Clerk's
 * error codes. Every tier that signs in against the dev instance describes a refusal this way, so a red run
 * names where it died without anyone opening a trace. Pure.
 *
 * ⛔ It takes no URL and no body on purpose: a Frontend API URL's query carries the dev-browser JWT, and a
 * Frontend API body piggybacks the client (`payload.client || payload.meta?.client`, as clerk-js reads it),
 * whose sessions carry `last_active_token.jwt`.
 */
export function describeClerkRefusal(refused: {
    readonly step: string;
    readonly identity: string;
    readonly status: number | undefined;
    readonly retryAfter: string | null;
    readonly codes: readonly string[];
}): string {
    const codes = refused.codes.length > 0 ? refused.codes.join(', ') : 'no error code';

    return (
        `Clerk refused the ${refused.step} for ${refused.identity}: ${refused.status ?? 'no response'}, ` +
        `retry-after ${refused.retryAfter ?? 'none'}, ${codes}`
    );
}

/**
 * A Backend API failure as {@link describeClerkRefusal} words it, keeping the original as the cause; anything that is
 * not a Clerk API error is returned untouched. Pure.
 */
export function describeClerkBackendFailure(step: string, identity: string, error: unknown): unknown {
    if (!isClerkAPIResponseError(error)) {
        return error;
    }

    return new Error(
        describeClerkRefusal({
            step,
            identity,
            status: Number.isInteger(error.status) ? error.status : undefined,
            retryAfter: error.retryAfter === undefined ? null : String(error.retryAfter),
            codes: error.errors.map((entry) => entry.code),
        }),
        { cause: error },
    );
}

/** The error codes a Clerk error body carries, and nothing else from it. Pure. */
function errorCodes(body: Record<string, unknown>): readonly string[] {
    const errors = body['errors'];

    return Array.isArray(errors)
        ? errors.map((entry: unknown) =>
              typeof entry === 'object' && entry !== null && typeof (entry as { code?: unknown }).code === 'string'
                  ? (entry as { code: string }).code
                  : 'unknown',
          )
        : [];
}

/** The error for a Frontend API step that did not answer 2xx — see {@link describeClerkRefusal}. */
async function refusal(step: string, identity: string, response: Response): Promise<Error> {
    return new Error(
        describeClerkRefusal({
            step,
            identity,
            status: response.status,
            retryAfter: response.headers.get('retry-after'),
            codes: errorCodes(await asJson(response)),
        }),
    );
}

/**
 * The tail of this process's sign-in queue. Every {@link establishSession} runs after the one before it has
 * settled — INCLUDING its post-create pause — so concurrent callers cannot crowd Clerk's create window.
 */
let signInQueue: Promise<unknown> = Promise.resolve();

/** Set when a create was refused: the next sign-in pauses before its own create, because the refusal counted. */
let createPauseOwed = false;

/**
 * Sign `email` in by ticket and return the handle, WITHOUT minting a bearer.
 *
 * A throttled step THROWS with the `Retry-After` Clerk gave; it is never slept on, because the create limit's
 * measured penalty is ten minutes and a CI step that waits that long is a hang, not a recovery.
 *
 * Sign-ins in one process run one at a time, in call order — see {@link SIGN_IN_CREATE_GAP_MS}. A caller that
 * fails validation is refused at once and never joins the queue.
 *
 * @sideEffect Mints a ticket (Backend API), performs a Frontend API sign-in creating a Clerk session, then
 *   waits {@link SIGN_IN_CREATE_GAP_MS}.
 */
export function establishSession(input: {
    readonly email: string;
    readonly publishableKey: string;
    readonly origin: string;
    readonly mintTicket: TicketMinter;
    readonly fetch?: FetchLike;
    readonly sleep?: (ms: number) => Promise<void>;
}): Promise<SessionHandle> {
    try {
        // A ticket signs in WHOEVER it names, so only the committed pool roster may be named — stricter than the
        // `+clerk_test` check this replaced, which admitted every other test user on the shared instance.
        assertPoolMember(input.email);
        assertDevelopmentInstance(input.publishableKey);
    } catch (error) {
        return Promise.reject(error);
    }

    const turn = signInQueue.then(() => signInByTicket(input));

    // The queue advances on either outcome; a failed sign-in must never jam the ones behind it.
    signInQueue = turn.catch(() => undefined);

    return turn;
}

/**
 * One sign-in, run only from the queue in {@link establishSession}.
 *
 * @sideEffect See {@link establishSession}.
 */
async function signInByTicket(input: Parameters<typeof establishSession>[0]): Promise<SessionHandle> {
    const doFetch = input.fetch ?? globalThis.fetch;
    const sleep = input.sleep ?? ((ms: number) => delay(ms));
    const fapi = `https://${fapiHostFromPublishableKey(input.publishableKey)}/v1`;

    if (createPauseOwed) {
        createPauseOwed = false;
        await sleep(SIGN_IN_CREATE_GAP_MS);
    }

    let ticket: string;

    try {
        ticket = await input.mintTicket(input.email);
    } catch (error) {
        // The minter's own error names neither the identity nor the step; a Backend API error never carries the
        // ticket, which does not exist yet.
        throw new Error(
            `could not complete the ticket mint for ${input.email}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }

    const devBrowser = await doFetch(`${fapi}/dev_browser`, { method: 'POST', headers: { Origin: input.origin } });

    if (!devBrowser.ok) {
        throw await refusal('dev browser handshake', input.email, devBrowser);
    }

    const devJwt = (await asJson(devBrowser))['token'] as string | undefined;

    if (devJwt === undefined) {
        throw new Error('Clerk answered the dev browser handshake without a token');
    }

    const created = await doFetch(`${fapi}/client/sign_ins?__clerk_db_jwt=${devJwt}`, {
        method: 'POST',
        headers: { Origin: input.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ strategy: 'ticket', ticket }),
    });

    if (!created.ok) {
        createPauseOwed = true;
        throw await refusal('sign-in create', input.email, created);
    }

    const signIn = (await asJson(created))['response'] as
        { readonly status?: string; readonly created_session_id?: string } | undefined;

    if (signIn?.created_session_id === undefined) {
        createPauseOwed = true;
        throw new Error(`the ticket sign-in for ${input.email} did not complete: status ${String(signIn?.status)}`);
    }

    await sleep(SIGN_IN_CREATE_GAP_MS);

    return { sessionId: signIn.created_session_id, devJwt, fapi, origin: input.origin, email: input.email };
}

/**
 * Mint a fresh bearer from an established session. Cheap, and NOT the rate-limited endpoint.
 *
 * @sideEffect One Frontend API call.
 */
export async function remintFromSession(handle: SessionHandle, doFetch?: FetchLike): Promise<SessionCredential> {
    const fetchImpl = doFetch ?? globalThis.fetch;
    const response = await fetchImpl(
        `${handle.fapi}/client/sessions/${handle.sessionId}/tokens?__clerk_db_jwt=${handle.devJwt}`,
        { method: 'POST', headers: { Origin: handle.origin } },
    );
    const minted = await asJson(response);
    const token = response.ok ? (minted['jwt'] as string | undefined) : undefined;

    if (token === undefined) {
        // ⛔ Loud, and specific about the cause. A session that has been revoked (a real erasure, a
        // teardown that ran early, an instance reset) is indistinguishable from a transient failure at the
        // HTTP layer, and treating either as "no token this time" is how a run reports green over a world
        // it never seeded. ⛔ And never the body: see `describeClerkRefusal` for the live JWTs it can carry.
        throw new Error(
            `could not re-mint a token for ${handle.email} — the run's Clerk session is gone or unreachable. ` +
                describeClerkRefusal({
                    step: 'token re-mint',
                    identity: handle.email,
                    status: response.status,
                    retryAfter: response.headers.get('retry-after'),
                    codes: errorCodes(minted),
                }),
        );
    }

    return assertAzp(token, handle.origin);
}
