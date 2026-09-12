/**
 * A Clerk Frontend-API session, established ONCE and re-minted from cheaply.
 *
 * ## Why the session is held, rather than signing in again
 *
 * `mintSessionToken` signs in and returns a bearer. A deployed Maestro run needs a fresh bearer roughly
 * thirty-five times — once per per-flow fixture reset — and a Clerk session token lives about a minute, so
 * "call it again" means thirty-five SIGN-INS. FAPI sign-in is per-IP rate limited (it is why
 * `packages/tools/loadtest/auth/provision-pool.mjs` exists at all), and a multi-minute cool-down in the
 * middle of a fifty-minute emulator job is a failure nobody would attribute correctly.
 *
 * Minting a token FROM an existing session is a different endpoint and is not the limited one. So the
 * sign-in happens once, its handle is kept, and every later bearer comes from
 * `POST /client/sessions/{id}/tokens` — the shape a real browser uses, and the shape
 * `provision-users.mjs` already proves against this instance.
 *
 * ## Why `Origin` is on every call
 *
 * Clerk stamps the request `Origin` into the token as `azp`, and `azp` is what `CLERK_AZP_PATTERN` on the
 * deployed services is anchored against (ADR-0033). A re-mint that dropped it would return a token the
 * services refuse, and the refusal arrives as an opaque `401` from a service rather than as an error here.
 * {@link assertAzp} therefore checks the claim at the point it is produced.
 */

/** The fixed code every `+clerk_test` address accepts on a Clerk development instance. */
export const CLERK_TEST_CODE = '424242';

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
 * Refuse an address Clerk would treat as real.
 *
 * A real address would send real mail, consume the instance's monthly quota, and reject the fixed code —
 * so this is a correctness gate, not a style preference. Pure.
 */
export function assertTestAddress(email: string): void {
    if (!email.includes('+clerk_test')) {
        throw new Error(`${email} is not a Clerk test address — it must carry the '+clerk_test' subaddress`);
    }
}

/**
 * Sign `email` in and return the handle, WITHOUT minting a bearer.
 *
 * The first factor is `email_code` with the fixed dev code, not the password: a `+clerk_test` address
 * accepts it, sends no real mail, is exempt from the instance's monthly quota — and the instance requires
 * a second factor after a PASSWORD sign-in, which this path avoids entirely.
 *
 * @sideEffect Performs a Frontend API sign-in (network), creating a Clerk session.
 */
export async function establishSession(input: {
    readonly email: string;
    readonly publishableKey: string;
    readonly origin: string;
    readonly fetch?: FetchLike;
}): Promise<SessionHandle> {
    assertTestAddress(input.email);

    const doFetch = input.fetch ?? globalThis.fetch;
    const fapi = `https://${fapiHostFromPublishableKey(input.publishableKey)}/v1`;
    const formHeaders = { Origin: input.origin, 'Content-Type': 'application/x-www-form-urlencoded' };

    const devBrowser = await asJson(
        await doFetch(`${fapi}/dev_browser`, { method: 'POST', headers: { Origin: input.origin } }),
    );
    const devJwt = devBrowser['token'] as string | undefined;

    if (devJwt === undefined) {
        throw new Error(`dev_browser handshake failed: ${JSON.stringify(devBrowser)}`);
    }

    const query = `__clerk_db_jwt=${devJwt}`;
    const started = await asJson(
        await doFetch(`${fapi}/client/sign_ins?${query}`, {
            method: 'POST',
            headers: formHeaders,
            body: new URLSearchParams({ identifier: input.email }),
        }),
    );
    const signIn = started['response'] as
        { id?: string; supported_first_factors?: { strategy: string; email_address_id?: string }[] } | undefined;
    const factor = (signIn?.supported_first_factors ?? []).find((entry) => entry.strategy === 'email_code');

    if (signIn?.id === undefined || factor?.email_address_id === undefined) {
        throw new Error(`no email_code first factor for ${input.email}: ${JSON.stringify(started)}`);
    }

    await doFetch(`${fapi}/client/sign_ins/${signIn.id}/prepare_first_factor?${query}`, {
        method: 'POST',
        headers: formHeaders,
        body: new URLSearchParams({ strategy: 'email_code', email_address_id: factor.email_address_id }),
    });

    const attempted = await asJson(
        await doFetch(`${fapi}/client/sign_ins/${signIn.id}/attempt_first_factor?${query}`, {
            method: 'POST',
            headers: formHeaders,
            body: new URLSearchParams({ strategy: 'email_code', code: CLERK_TEST_CODE }),
        }),
    );
    const sessionId = (attempted['response'] as { created_session_id?: string } | undefined)?.created_session_id;

    if (sessionId === undefined) {
        throw new Error(`sign-in did not complete: ${JSON.stringify(attempted)}`);
    }

    return { sessionId, devJwt, fapi, origin: input.origin, email: input.email };
}

/**
 * Mint a fresh bearer from an established session. Cheap, and NOT the rate-limited endpoint.
 *
 * @sideEffect One Frontend API call.
 */
export async function remintFromSession(handle: SessionHandle, doFetch?: FetchLike): Promise<SessionCredential> {
    const fetchImpl = doFetch ?? globalThis.fetch;
    const minted = await asJson(
        await fetchImpl(`${handle.fapi}/client/sessions/${handle.sessionId}/tokens?__clerk_db_jwt=${handle.devJwt}`, {
            method: 'POST',
            headers: { Origin: handle.origin },
        }),
    );
    const token = minted['jwt'] as string | undefined;

    if (token === undefined) {
        // ⛔ Loud, and specific about the cause. A session that has been revoked (a real erasure, a
        // teardown that ran early, an instance reset) is indistinguishable from a transient failure at the
        // HTTP layer, and treating either as "no token this time" is how a run reports green over a world
        // it never seeded.
        throw new Error(
            `could not re-mint a token for ${handle.email} — the run's Clerk session is gone or unreachable: ` +
                JSON.stringify(minted),
        );
    }

    return assertAzp(token, handle.origin);
}
