/**
 * Mint a real Clerk session token for a `+clerk_test` profile, from the stage's OWN instance.
 *
 * ## Why a session token, and why THIS way
 *
 * A deployed stage verifies against its own Clerk instance, so a self-signed JWT — however well formed —
 * answers `401` from every service. A test credential has to come from the authority the system under test
 * trusts, or it is testing a different system.
 *
 * ⛔ Clerk's BACKEND API (`POST /sessions` then `POST /sessions/{id}/tokens`) is the obvious shortcut and is
 * REJECTED here: that token carries **no `azp`**, and an `azp`-less token is admitted only by the
 * `client_type: 'native'` gate the mobile app's own JWT template mints. Measured against a live `pr-{N}`
 * stage: `401` from both the recipe and food services.
 *
 * So the sign-in runs against the **Frontend API** with `Origin` set to the stage's web origin, because that
 * Origin is what Clerk stamps as `azp` — which is what `CLERK_AZP_PATTERN` on the deployed services is
 * anchored against (ADR-0033). The resulting token is the same shape a real browser session carries.
 *
 * The first factor is `email_code` with the fixed dev code, not the password: a `+clerk_test` address
 * accepts it, sends no real mail, and is exempt from the instance's monthly quota — and the instance
 * requires a second factor after a password sign-in, which the code path avoids entirely.
 *
 * ⚠️ FAPI sign-in is per-IP rate limited. Mint ONE token per run and reuse it; a pool of them from one
 * machine trips a multi-minute cool-down (`packages/tools/loadtest/provision-pool.mjs` exists because of
 * that limit).
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
 * The instance's Frontend API host, decoded from the publishable key (`pk_test_<base64url("host$")>`)
 * rather than configured separately, so the FAPI host and the verifying instance cannot drift. Pure.
 */
export const fapiHostFromPublishableKey = (publishableKey: string): string =>
    Buffer.from(publishableKey.split('_').slice(2).join('_'), 'base64').toString('utf8').replace(/\$$/, '');

const asJson = async (response: Response): Promise<Record<string, unknown>> => {
    const text = await response.text();

    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return { raw: text };
    }
};

/**
 * Sign `email` in against `publishableKey`'s instance and return a session token whose `azp` is `origin`.
 *
 * @sideEffect Performs a Frontend API sign-in (network), creating a Clerk session.
 */
export async function mintSessionToken(input: {
    readonly email: string;
    readonly publishableKey: string;
    readonly origin: string;
}): Promise<SessionCredential> {
    if (!input.email.includes('+clerk_test')) {
        // A real address would send real mail, consume the instance's monthly quota, and reject the fixed
        // code below — so this is a correctness gate, not a style preference.
        throw new Error(`${input.email} is not a Clerk test address — it must carry the '+clerk_test' subaddress`);
    }

    const fapi = `https://${fapiHostFromPublishableKey(input.publishableKey)}/v1`;
    const formHeaders = { Origin: input.origin, 'Content-Type': 'application/x-www-form-urlencoded' };

    const devBrowser = await asJson(
        await fetch(`${fapi}/dev_browser`, { method: 'POST', headers: { Origin: input.origin } }),
    );
    const devJwt = devBrowser['token'] as string | undefined;

    if (devJwt === undefined) {
        throw new Error(`dev_browser handshake failed: ${JSON.stringify(devBrowser)}`);
    }

    const query = `__clerk_db_jwt=${devJwt}`;
    const started = await asJson(
        await fetch(`${fapi}/client/sign_ins?${query}`, {
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

    await fetch(`${fapi}/client/sign_ins/${signIn.id}/prepare_first_factor?${query}`, {
        method: 'POST',
        headers: formHeaders,
        body: new URLSearchParams({ strategy: 'email_code', email_address_id: factor.email_address_id }),
    });

    const attempted = await asJson(
        await fetch(`${fapi}/client/sign_ins/${signIn.id}/attempt_first_factor?${query}`, {
            method: 'POST',
            headers: formHeaders,
            body: new URLSearchParams({ strategy: 'email_code', code: CLERK_TEST_CODE }),
        }),
    );
    const sessionId = (attempted['response'] as { created_session_id?: string } | undefined)?.created_session_id;

    if (sessionId === undefined) {
        throw new Error(`sign-in did not complete: ${JSON.stringify(attempted)}`);
    }

    const minted = await asJson(
        await fetch(`${fapi}/client/sessions/${sessionId}/tokens?${query}`, {
            method: 'POST',
            headers: { Origin: input.origin },
        }),
    );
    const token = minted['jwt'] as string | undefined;

    if (token === undefined) {
        throw new Error(`could not mint a session token: ${JSON.stringify(minted)}`);
    }

    // Assert the property the deployed services actually check, HERE, where the failure is legible. Without
    // it the caller fails later as an opaque 401 from a service, which is what cost the original diagnosis.
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
        azp?: string;
        sub?: string;
    };

    if (claims.azp !== input.origin) {
        throw new Error(`minted token carries azp=${String(claims.azp)}, expected ${input.origin}`);
    }

    return { token, azp: input.origin, sub: claims.sub ?? '' };
}
