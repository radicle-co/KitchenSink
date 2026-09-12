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
 * The test pool's **linkage slot** — a fixed `+clerk_test` user on the development instance, provisioned by
 * `poolAdmin` with the grants below and leased here, so repeat runs reuse one user and no run creates one.
 *
 * The sign-in is `@kitchensink/e2e-fixtures`' `leaseSession` over `establishSession` — a ticket, against the **Frontend API**, with
 * `Origin` set to the stage's own web origin, because that Origin is what Clerk mints as `azp` — which is what `CLERK_AZP_PATTERN` on the deployed services is
 * anchored against (ADR-0001). The resulting token is therefore the same shape a real browser session
 * carries: signed by the stage's instance, carrying the right `azp`, and carrying grants in the signed
 * `public_metadata` that the production guards read.
 *
 * Usage:
 *     npx tsx scripts/mintLinkageCredentials.ts <outputDirectory>
 *
 * Env: `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` (the FAPI host is decoded from the latter, so the
 * instance can never drift from the keys), and `LINKAGE_AZP` (the stage's web origin).
 *
 * @sideEffect Looks up the leased pool user, signs in against the Frontend API, and writes a file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeClaims, remintFromSession } from '@kitchensink/e2e-fixtures';
import { clerkLeasePort, leaseSession, resolvePoolUser } from '@kitchensink/e2e-fixtures/lease';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

/** Filename the workflow and the spec both address this artefact by. */
export const LINKAGE_CREDENTIALS_FILENAME = 'linkage-credentials.json';

/**
 * The identity: the test pool's LINKAGE slot, whose roster entry declares the grants below.
 *
 * ⛔ It is LEASED, never created (owner ruling 2026-09-13). This used to find-or-create a fixed
 * `linkage-e2e+clerk_test@example.com` profile, writing its `public_metadata.scopes` at creation — a second Clerk
 * user-creation path and a second metadata writer. `poolAdmin` is now the only one of either; an unprovisioned slot
 * fails here and the fix is `poolAdmin --apply`.
 */
const SLOT = slotFor('linkage', 'linkage');

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

const main = async (): Promise<void> => {
    const outputDirectory = process.argv[2];

    if (outputDirectory === undefined || outputDirectory.trim() === '') {
        throw new Error('usage: mintLinkageCredentials.ts <outputDirectory>');
    }

    const secretKey = required('CLERK_SECRET_KEY');
    const publishableKey = required('CLERK_PUBLISHABLE_KEY');
    const origin = required('LINKAGE_AZP');
    const port = clerkLeasePort(secretKey);
    // Resolved first for the app-user id; `leaseSession` resolves again and refuses an unprovisioned slot.
    const user = await resolvePoolUser(SLOT, port);
    // Sign in by ticket on the Frontend API, so the token carries this stage's origin as `azp`. `remintFromSession`
    // refuses a token whose `azp` is not `origin` — the check that used to be spelled out here.
    const { handle } = await leaseSession({ slot: SLOT, publishableKey, origin, port });
    const { token } = await remintFromSession(handle);
    const claims = decodeClaims(token) as ReturnType<typeof decodeClaims> & {
        readonly public_metadata?: { readonly scopes?: readonly string[] };
    };

    if ((claims.public_metadata?.scopes ?? []).length === 0) {
        throw new Error(
            'minted token carries no signed public_metadata.scopes — the guards read grants only from there',
        );
    }

    const credentials: LinkageCredentials = {
        token,
        azp: origin,
        sub: claims.sub ?? user.id,
        externalId: user.externalId ?? user.id,
        scopes: [...SLOT.scopes],
    };

    const directory = resolve(outputDirectory);

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, LINKAGE_CREDENTIALS_FILENAME), JSON.stringify(credentials), 'utf-8');

    console.log(
        `mint-linkage-credentials: wrote ${join(directory, LINKAGE_CREDENTIALS_FILENAME)} ` +
            `(profile=${SLOT.email}, azp=${origin}, sub=${credentials.sub}, scopes=[${SLOT.scopes.join(' ')}])`,
    );
};

await main();
