/**
 * Mint the ONE Clerk credential the cross-service linkage tier sends, from the stage's OWN Clerk instance.
 *
 * ## Why this exists
 *
 * Recipe-service calls food-service AS THE CALLER: it forwards the caller's own verified Clerk bearer
 * (`src/auth/CallerToken.ts` — "There is deliberately NO `FOOD_SERVICE_TOKEN`"). So a live linkage proof
 * cannot use recipe's dev-auth bypass: with no bearer to forward, `FoodCatalogGateway` degrades to
 * `catalogAvailability: 'unavailable'` WITHOUT issuing a request, and the test would "pass" having proved
 * nothing about the wire.
 *
 * ## Why it is NOT a self-signed token any more
 *
 * ⛔ This used to generate a throwaway RSA keypair and sign its own JWT, which worked only while both
 * services were booted ON THE RUNNER against that generated key. A DEPLOYED stage verifies against its own
 * Clerk instance and has never heard of it, so every authenticated call answered `401` — observed on the
 * first live sandbox. A test credential has to be minted by the same authority the system under test
 * trusts, or it is testing a different system.
 *
 * ⛔ The obvious replacement — Clerk's Backend API (`POST /sessions` then `POST /sessions/{id}/tokens`) —
 * is ALSO rejected here, and the reason is worth keeping: that token carries **no `azp`**, and an
 * `azp`-less token is admitted only by `isNativeClientToken` (the `client_type: 'native'` claim minted by
 * the mobile app's own JWT template), whose docstring is explicit that a token is admitted because it
 * PROVES it is native, "not merely because it lacks an origin". Measured against the live `pr-91` stage: a
 * Backend-API token returns `401` from BOTH services. ⚠️ `packages/tools/loadtest/provision-pool.mjs`
 * still carries a comment claiming such a token was "Confirmed: GET /api/v1/foods/search → 200" — that was
 * true before the `azp` pattern guard landed and is stale now; do not follow it back here.
 *
 * ## What it does instead
 *
 * A **Clerk test profile** — any `+clerk_test` subaddress on a development instance, which verifies with
 * the fixed code `424242`, sends no real mail and is exempt from the instance's monthly email quota. The
 * profile is FIXED and found-or-created, so repeat runs reuse one user instead of littering the shared dev
 * instance (the fixture-collision hazard `runFixtureIdentity.ts` documents for the Playwright suite).
 *
 * The sign-in runs against the **Frontend API** with `Origin` set to the stage's own web origin, because
 * that Origin is what Clerk mints as `azp` — which is what `CLERK_AZP_PATTERN` on the deployed services is
 * anchored against (ADR-0001). The resulting token is therefore the same shape a real browser session
 * carries: signed by the stage's instance, carrying the right `azp`, and carrying grants in the signed
 * `public_metadata` that the production guards read.
 *
 * Usage:
 *     npx tsx scripts/mintLinkageCredentials.ts <outputDirectory>
 *
 * Env: `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` (the FAPI host is decoded from the latter, so the
 * instance can never drift from the keys), `LINKAGE_AZP` (the stage's web origin), and optionally
 * `LINKAGE_E2E_TEST_EMAIL` (defaults to the fixed profile below).
 *
 * @sideEffect Creates or reuses a Clerk user, signs in against the Frontend API, and writes a file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Filename the workflow and the spec both address this artefact by. */
export const LINKAGE_CREDENTIALS_FILENAME = 'linkage-credentials.json';

/** The fixed code every `+clerk_test` address accepts on a Clerk development instance. */
const CLERK_TEST_CODE = '424242';

/** The fixed test profile. `+clerk_test` is what makes it a test address rather than a real mailbox. */
const DEFAULT_TEST_EMAIL = 'linkage-e2e+clerk_test@example.com';

/** Grants the token carries in its SIGNED `public_metadata` — the only place the guards read them from. */
const SCOPES = ['recipes:write', 'foods:read'] as const;

/** The credential artefact this writes; the spec sends its `token` as the bearer. */
export interface LinkageCredentials {
    /** The Clerk-signed bearer the spec sends to recipe, and which recipe forwards to food. */
    readonly token: string;
    /** The `azp` the token carries — must satisfy the deployed services' `CLERK_AZP_PATTERN`. */
    readonly azp: string;
    /** The Clerk subject. */
    readonly sub: string;
    /** The app-user id carried for attribution. */
    readonly externalId: string;
    /** The grants embedded in the token's signed `public_metadata.scopes`. */
    readonly scopes: readonly string[];
}

const required = (name: string): string => {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
        throw new Error(`${name} is required to mint a linkage credential`);
    }

    return value;
};

/**
 * The instance's Frontend API host, decoded from the publishable key rather than configured separately —
 * `pk_test_<base64url("host$")>`. Deriving it means the FAPI host and the verifying instance cannot drift.
 * Pure.
 */
export const fapiHostFromPublishableKey = (publishableKey: string): string => {
    const encoded = publishableKey.split('_').slice(2).join('_');
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');

    return decoded.replace(/\$$/, '');
};

const asJson = async (response: Response): Promise<{ status: number; body: Record<string, unknown> }> => {
    const text = await response.text();

    try {
        return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
    } catch {
        return { status: response.status, body: { raw: text } };
    }
};

const main = async (): Promise<void> => {
    const outputDirectory = process.argv[2];

    if (outputDirectory === undefined || outputDirectory.trim() === '') {
        throw new Error('usage: mintLinkageCredentials.ts <outputDirectory>');
    }

    const secretKey = required('CLERK_SECRET_KEY');
    const fapi = `https://${fapiHostFromPublishableKey(required('CLERK_PUBLISHABLE_KEY'))}/v1`;
    const origin = required('LINKAGE_AZP');
    const email = process.env['LINKAGE_E2E_TEST_EMAIL']?.trim() || DEFAULT_TEST_EMAIL;

    if (!email.includes('+clerk_test')) {
        // A real address would send real mail and consume the instance's monthly quota, and would not
        // accept the fixed code below — so this is a correctness gate, not a style preference.
        throw new Error(`${email} is not a Clerk test address — it must carry the '+clerk_test' subaddress`);
    }

    const backendHeaders = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };

    // ── Find or create the fixed profile ──────────────────────────────────────────────────────────────
    const found = await asJson(
        await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, {
            headers: backendHeaders,
        }),
    );
    const existing = (Array.isArray(found.body) ? found.body : ((found.body['data'] as unknown[]) ?? []))[0] as
        { id: string } | undefined;

    let userId = existing?.id;

    if (userId === undefined) {
        const created = await asJson(
            await fetch('https://api.clerk.com/v1/users', {
                method: 'POST',
                headers: backendHeaders,
                body: JSON.stringify({
                    email_address: [email],
                    // The instance requires these; the password is never used, because the sign-in below
                    // takes the email-code path that the test address exists for.
                    password: `linkage-${Date.now()}-${Math.random().toString(36).slice(2)}Aa1!`,
                    first_name: 'Linkage',
                    last_name: 'Fixture',
                    username: `linkage_e2e_${Date.now()}`,
                    public_metadata: { scopes: SCOPES, permissions: [] },
                    skip_password_checks: true,
                }),
            }),
        );

        userId = (created.body['id'] as string | undefined) ?? undefined;

        if (userId === undefined) {
            throw new Error(`could not create the linkage test profile: ${JSON.stringify(created.body)}`);
        }
    }

    // ── Sign in on the Frontend API, so the token carries this stage's origin as `azp` ────────────────
    const devBrowser = await asJson(
        await fetch(`${fapi}/dev_browser`, { method: 'POST', headers: { Origin: origin } }),
    );
    const devJwt = devBrowser.body['token'] as string | undefined;

    if (devJwt === undefined) {
        throw new Error(`dev_browser handshake failed: ${JSON.stringify(devBrowser.body)}`);
    }

    const query = `__clerk_db_jwt=${devJwt}`;
    const formHeaders = { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' };

    const started = await asJson(
        await fetch(`${fapi}/client/sign_ins?${query}`, {
            method: 'POST',
            headers: formHeaders,
            body: new URLSearchParams({ identifier: email }),
        }),
    );
    const signIn = started.body['response'] as
        { id?: string; supported_first_factors?: { strategy: string; email_address_id?: string }[] } | undefined;
    const emailFactor = (signIn?.supported_first_factors ?? []).find((factor) => factor.strategy === 'email_code');

    if (signIn?.id === undefined || emailFactor?.email_address_id === undefined) {
        throw new Error(`no email_code first factor for ${email}: ${JSON.stringify(started.body)}`);
    }

    await fetch(`${fapi}/client/sign_ins/${signIn.id}/prepare_first_factor?${query}`, {
        method: 'POST',
        headers: formHeaders,
        body: new URLSearchParams({ strategy: 'email_code', email_address_id: emailFactor.email_address_id }),
    });

    const attempted = await asJson(
        await fetch(`${fapi}/client/sign_ins/${signIn.id}/attempt_first_factor?${query}`, {
            method: 'POST',
            headers: formHeaders,
            body: new URLSearchParams({ strategy: 'email_code', code: CLERK_TEST_CODE }),
        }),
    );
    const sessionId = (attempted.body['response'] as { created_session_id?: string } | undefined)?.created_session_id;

    if (sessionId === undefined) {
        throw new Error(`sign-in did not complete: ${JSON.stringify(attempted.body)}`);
    }

    const minted = await asJson(
        await fetch(`${fapi}/client/sessions/${sessionId}/tokens?${query}`, {
            method: 'POST',
            headers: { Origin: origin },
        }),
    );
    const token = minted.body['jwt'] as string | undefined;

    if (token === undefined) {
        throw new Error(`could not mint a session token: ${JSON.stringify(minted.body)}`);
    }

    // Assert the two properties the deployed services actually check, HERE, where the failure is legible.
    // Without this the suite would fail later as an opaque 401 from a service, which is what cost the
    // original diagnosis.
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
        azp?: string;
        sub?: string;
        public_metadata?: { scopes?: string[] };
    };

    if (claims.azp !== origin) {
        throw new Error(`minted token carries azp=${String(claims.azp)}, expected ${origin}`);
    }

    if ((claims.public_metadata?.scopes ?? []).length === 0) {
        throw new Error(
            'minted token carries no signed public_metadata.scopes — the guards read grants only from there',
        );
    }

    const credentials: LinkageCredentials = {
        token,
        azp: origin,
        sub: claims.sub ?? userId,
        externalId: userId,
        scopes: [...SCOPES],
    };

    const directory = resolve(outputDirectory);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, LINKAGE_CREDENTIALS_FILENAME), JSON.stringify(credentials), 'utf-8');

    console.log(
        `mint-linkage-credentials: wrote ${join(directory, LINKAGE_CREDENTIALS_FILENAME)} ` +
            `(profile=${email}, azp=${origin}, sub=${credentials.sub}, scopes=[${SCOPES.join(' ')}])`,
    );
};

await main();
