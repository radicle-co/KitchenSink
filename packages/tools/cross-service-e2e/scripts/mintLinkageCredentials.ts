/**
 * Mint the ONE Clerk credential both services in the cross-service linkage tier trust.
 *
 * ## Why this exists
 *
 * Recipe-service calls food-service AS THE CALLER: it forwards the caller's own verified Clerk bearer
 * (`src/auth/CallerToken.ts` — "There is deliberately NO `FOOD_SERVICE_TOKEN`"). So a live linkage proof
 * cannot use recipe's dev-auth bypass: with no bearer to forward, `FoodCatalogGateway` degrades to
 * `catalogAvailability: 'unavailable'` WITHOUT issuing a request, and the test would "pass" having proved
 * nothing about the wire. The two services must therefore verify the SAME signing key and both accept the
 * token's `azp` — which is exactly how they are configured in a real stage (both read the same SSM
 * parameters).
 *
 * A throwaway 2048-bit RSA keypair is generated per run. Clerk's networkless verifier takes
 * `CLERK_JWT_KEY` as an SPKI PEM and assumes `e = 65537`, which is what `jose` emits for `RS256`, so the
 * exported PEM is usable verbatim by both services with no Clerk network call and no secret key.
 *
 * Signing is done with `jose` rather than hand-assembled base64url segments — the repo's library-first
 * rule, and `jose` is already a dependency of four packages here.
 *
 * Usage:
 *     npx tsx scripts/mintLinkageCredentials.ts <outputDirectory>
 *
 * Writes ONE file, `linkage-credentials.json`, holding the public PEM, the bearer, and the identity the
 * bearer carries — one authoritative artefact, so the booted services and the spec can never be
 * configured against different credentials.
 *
 * @sideEffect Draws from the system CSPRNG, reads the clock, and writes a file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SignJWT, exportSPKI, generateKeyPair } from 'jose';

/** Filename the workflow and the spec both address this artefact by. */
export const LINKAGE_CREDENTIALS_FILENAME = 'linkage-credentials.json';

/**
 * The authorized party both services are configured to accept. It is the recipe API's own origin because
 * that is what a browser session token would carry in a local/dev stage.
 */
const AZP = process.env['LINKAGE_AZP'] ?? 'http://localhost:3000';

/**
 * The Clerk subject and the app-user ULID it maps to.
 *
 * The ULID is fixed (not random) so a failing run is reproducible and the seeded databases can be
 * inspected afterwards. Crockford base32 excludes `I`, `L`, `O` and `U`, and a ULID's first character
 * must be `<= '7'` — this value satisfies both, so recipe's and food's id validators accept it.
 */
const SUB = process.env['LINKAGE_SUB'] ?? 'user_2linkageproofsubject';
const EXTERNAL_ID = process.env['LINKAGE_EXTERNAL_ID'] ?? '01JXK5N9000000000000000001';

/** Token lifetime. Long enough for the whole suite, short enough to be worthless if it ever leaked. */
const TTL_SECONDS = Number(process.env['LINKAGE_TOKEN_TTL_SECONDS'] ?? 3600);

/**
 * Grants to embed in the token's `public_metadata.scopes`.
 *
 * DEFAULTS TO NONE, so every existing caller of this script mints exactly the credential it always did —
 * the linkage suite proves the UNPRIVILEGED path and must keep doing so. `LINKAGE_SCOPES` exists for the
 * curated-import tooling, which needs `recipes:import:public` (ADR-0023) to declare provenance, and it is
 * set HERE rather than injected later because the grant is only trustworthy inside the SIGNED
 * `public_metadata` — a top-level claim, or a header, is never read as a grant by either service.
 */
const SCOPES = (process.env['LINKAGE_SCOPES'] ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

/** The artefact both the booted services and the spec are configured from. */
export interface LinkageCredentials {
    /** SPKI public-key PEM — set as `CLERK_JWT_KEY` on BOTH services. */
    readonly publicKeyPem: string;
    /** The signed bearer the spec sends to recipe, and which recipe forwards to food. */
    readonly token: string;
    /** The `azp` the token carries — must be in both services' `CLERK_AUTHORIZED_PARTIES`. */
    readonly azp: string;
    /** The Clerk subject. */
    readonly sub: string;
    /** The app-user ULID carried as `external_id`. */
    readonly externalId: string;
    /** The grants embedded in the token's signed `public_metadata.scopes` (empty unless requested). */
    readonly scopes: readonly string[];
}

const outputDirectory = process.argv[2];

if (outputDirectory === undefined || outputDirectory.trim() === '') {
    console.error('usage: mintLinkageCredentials.ts <outputDirectory>');
    process.exit(2);
}

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const publicKeyPem = await exportSPKI(publicKey);

const nowSeconds = Math.floor(Date.now() / 1000);
const token = await new SignJWT({
    // Carried so food's enqueue paths can attribute a fetch to a user principal, and so recipe resolves
    // the same owner on every request in the suite.
    external_id: EXTERNAL_ID,
    azp: AZP,
    // The production guards read grants from the SIGNED `public_metadata`, never a top-level claim.
    public_metadata: { scopes: SCOPES, permissions: [] },
})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'linkage' })
    .setSubject(SUB)
    .setIssuedAt(nowSeconds)
    .setNotBefore(nowSeconds - 5)
    .setExpirationTime(nowSeconds + TTL_SECONDS)
    .sign(privateKey);

const credentials: LinkageCredentials = {
    publicKeyPem,
    token,
    azp: AZP,
    sub: SUB,
    externalId: EXTERNAL_ID,
    scopes: SCOPES,
};

const directory = resolve(outputDirectory);
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, LINKAGE_CREDENTIALS_FILENAME), JSON.stringify(credentials), 'utf-8');

console.log(
    `mint-linkage-credentials: wrote ${join(directory, LINKAGE_CREDENTIALS_FILENAME)} ` +
        `(azp=${AZP}, sub=${SUB}, external_id=${EXTERNAL_ID}, scopes=[${SCOPES.join(' ')}], ttl=${TTL_SECONDS}s)`,
);
