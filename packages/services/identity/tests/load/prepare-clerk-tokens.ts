/**
 * Mint the Clerk session tokens the identity k6 load suite presents — WITHOUT touching a live Clerk
 * instance.
 *
 * WHY a prepare step, and why not real Clerk tokens. Identity protects every route except `/health` with
 * `AuthMiddleware` → `ClerkAuthService` → `@kitchensink/clerk-verify`, which verifies an RS256 JWT
 * networklessly against a pinned PEM public key (`CLERK_JWT_KEY`) and enforces `azp`. Two consequences:
 *
 *  1. k6's goja runtime cannot sign RS256, so tokens must be minted outside k6 and loaded via `open()`
 *     (the same shape as recipe/food's `prepare-erasure-tokens.ts`).
 *  2. Because verification is networkless against a key WE choose, a throwaway keypair is enough. The
 *     service under test is booted with the public half as `CLERK_JWT_KEY`, and every token below drives
 *     the REAL verifier, the REAL `azp` boundary and the REAL read-through provisioning — with ZERO
 *     requests to Clerk. This is deliberate and load-bearing: the shared sandbox Clerk dev instance is a
 *     single per-IP rate limit, and minting a pool from one runner (let alone re-minting per iteration)
 *     trips a multi-minute cool-down that turns CI red for reasons unrelated to identity's performance.
 *     Do NOT "improve" this by provisioning real Clerk users — see `packages/tools/loadtest/README.md`,
 *     which documents exactly that throttle for the food journey.
 *
 * It emits TWO artifacts next to the k6 scripts:
 *   - `clerk-public-key.pem` — the SPKI public key the identity service under test must be booted with
 *     (`CLERK_JWT_KEY`). A fresh throwaway keypair every run; the private half never leaves this process.
 *   - `clerk-tokens.json` — every pool the scenarios consume:
 *       `warm[]`   one token per pre-seeded warm principal; scripts rotate through it by scenario
 *                  iteration (never by `__VU` — that id is global across scenarios, see common.js).
 *       `cold[]`   tokens for NEVER-SEEDED subs — each may be presented exactly ONCE (first request
 *                  provisions the user), which is why the pool is large and its exhaustion is a
 *                  threshold failure rather than a silent slide into measuring the warm path.
 *       `admin`    a warm-seeded principal whose signed `public_metadata.scopes` carries `admin:users`.
 *       `reject`   the four rejection shapes, each a DIFFERENT reason the verifier must fail closed on:
 *                  `badSignature` (signed by a second, untrusted keypair), `expired`, `wrongAzp`
 *                  (correctly signed, `azp` outside the allowlist — the sandbox trust boundary), and
 *                  `malformed` (not a JWT at all).
 *
 * TTL: `IDENTITY_TOKEN_TTL_SECONDS` (default 3600). Unlike the erasure tokens there is no contract cap
 * here — `@clerk/backend` enforces `exp`/`nbf`/`iat` but no maximum lifetime — so a comfortable hour
 * removes the token-expiry flake class entirely, and the pools can be minted once and reused across the
 * whole suite regardless of scenario ordering.
 *
 * Usage (from packages/services/identity):
 *   npx tsx tests/load/prepare-clerk-tokens.ts
 *   IDENTITY_COLD_POOL_SIZE=20000 npx tsx tests/load/prepare-clerk-tokens.ts
 *
 * @sideEffect Draws from the system CSPRNG, reads the clock, and writes two files next to this script.
 */
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADMIN_SCOPE, adminIdentity, coldIdentity, warmIdentity } from './pool-identities.js';

const outDir = dirname(fileURLToPath(import.meta.url));

/**
 * The `azp` every valid token claims. The service under test is booted with
 * `CLERK_AUTHORIZED_PARTIES=<this>`, i.e. EXACT-MATCH list mode — the production posture (ADR-0001: prod
 * is a single origin with exact-match `azp`; only sandbox previews use the anchored pattern). Under a
 * reserved `.test` TLD so it can never be confused with a deployed origin.
 */
const AZP = process.env['IDENTITY_LOAD_AZP'] ?? 'https://identity-load.test';

/** An `azp` deliberately OUTSIDE the allowlist, for the rejection scenario. */
const WRONG_AZP = 'https://attacker.identity-load.test';

const TTL_SECONDS = Math.max(60, Number(process.env['IDENTITY_TOKEN_TTL_SECONDS'] ?? 3600));
const WARM_POOL_SIZE = Math.max(1, Number(process.env['IDENTITY_WARM_POOL_SIZE'] ?? 50));
const COLD_POOL_SIZE = Math.max(1, Number(process.env['IDENTITY_COLD_POOL_SIZE'] ?? 6000));

/** A throwaway RSA keypair: the SPKI public PEM (the `CLERK_JWT_KEY`) and its PKCS#8 private PEM. */
interface ClerkKeypair {
    readonly publicKeyPem: string;
    readonly privateKeyPem: string;
}

/** The claims a minted token carries. */
interface MintOptions {
    /** The Clerk subject — what `resolveOrCreateFromClaims` keys `users.identity_id` on. */
    readonly sub: string;
    /** The `email` claim; identity writes it to `users.email` on first-sight provisioning. */
    readonly email?: string;
    /** The app-user ULID emitted as `external_id` (surfaced as `claims.userId`). */
    readonly externalId?: string;
    /** The authorized party. */
    readonly azp: string;
    /** Grants embedded in the signed `public_metadata` — the ONLY place the verifier reads them from. */
    readonly scopes?: readonly string[];
    /** Seconds until expiry. Negative mints an already-expired token. */
    readonly expiresInSeconds: number;
}

/**
 * Generate a throwaway 2048-bit RSA keypair. Clerk's local JWK loader strips the fixed SPKI prefix and
 * assumes `e = AQAB` (65537), which is exactly a Node `modulusLength: 2048` SPKI key — so the exported PEM
 * works verbatim as `CLERK_JWT_KEY`.
 *
 * @returns The SPKI public PEM and its PKCS#8 private PEM.
 * @sideEffect Draws from the system CSPRNG.
 */
function generateClerkKeypair(): ClerkKeypair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/** Base64url-encode a UTF-8 string. Pure. */
function base64Url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Mint a Clerk-compatible RS256 JWT signed with `privateKeyPem`.
 *
 * @param privateKeyPem - The signing key.
 * @param options - Subject, authorized party, grants and expiry window.
 * @returns A signed `header.payload.signature` bearer token.
 * @sideEffect Reads the system clock and signs with the private key.
 */
function mintToken(privateKeyPem: string, options: MintOptions): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: 'identity-load' };
    const payload = {
        sub: options.sub,
        ...(options.externalId !== undefined ? { external_id: options.externalId } : {}),
        ...(options.email !== undefined ? { email: options.email } : {}),
        azp: options.azp,
        iat: nowSeconds,
        nbf: nowSeconds - 5,
        exp: nowSeconds + options.expiresInSeconds,
        public_metadata: { scopes: [...(options.scopes ?? [])], permissions: [] },
    };

    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem).toString('base64url');

    return `${signingInput}.${signature}`;
}

const keypair = generateClerkKeypair();
// A SECOND keypair the service is NOT booted with: its tokens are structurally perfect and correctly
// signed — just by the wrong signer. That is the rejection case that actually exercises the signature
// check, as opposed to a malformed string the parser throws out before any crypto happens.
const untrusted = generateClerkKeypair();

const warm: string[] = [];

for (let index = 0; index < WARM_POOL_SIZE; index += 1) {
    const identity = warmIdentity(index);
    warm.push(
        mintToken(keypair.privateKeyPem, {
            sub: identity.sub,
            email: identity.email,
            externalId: identity.userId,
            azp: AZP,
            expiresInSeconds: TTL_SECONDS,
        }),
    );
}

const cold: string[] = [];

for (let index = 0; index < COLD_POOL_SIZE; index += 1) {
    const identity = coldIdentity(index);
    // No `external_id`: a genuinely new identity has no app ULID yet (the first-token sync race the
    // shared verifier documents), so omitting it is what a real first request looks like.
    cold.push(
        mintToken(keypair.privateKeyPem, {
            sub: identity.sub,
            email: identity.email,
            azp: AZP,
            expiresInSeconds: TTL_SECONDS,
        }),
    );
}

const admin = adminIdentity();
const adminToken = mintToken(keypair.privateKeyPem, {
    sub: admin.sub,
    email: admin.email,
    externalId: admin.userId,
    azp: AZP,
    scopes: [ADMIN_SCOPE],
    expiresInSeconds: TTL_SECONDS,
});

const reject = {
    badSignature: mintToken(untrusted.privateKeyPem, {
        sub: warmIdentity(0).sub,
        email: warmIdentity(0).email,
        azp: AZP,
        expiresInSeconds: TTL_SECONDS,
    }),
    expired: mintToken(keypair.privateKeyPem, {
        sub: warmIdentity(0).sub,
        email: warmIdentity(0).email,
        azp: AZP,
        expiresInSeconds: -60,
    }),
    wrongAzp: mintToken(keypair.privateKeyPem, {
        sub: warmIdentity(0).sub,
        email: warmIdentity(0).email,
        azp: WRONG_AZP,
        expiresInSeconds: TTL_SECONDS,
    }),
    malformed: 'not-a-jwt.at-all',
};

writeFileSync(join(outDir, 'clerk-public-key.pem'), keypair.publicKeyPem, 'utf-8');
writeFileSync(
    join(outDir, 'clerk-tokens.json'),
    JSON.stringify(
        {
            azp: AZP,
            ttlSeconds: TTL_SECONDS,
            warm,
            cold,
            admin: adminToken,
            reject,
            // Search terms for `admin-user-search.load.js`. Emitted as DATA so the k6 script never
            // re-derives a fixture rule (pool-identities.mjs stays the one place those rules live).
            //
            // The needles are chosen so the scenario measures the query it CLAIMS to measure. Both
            // `ilike` needles match FEWER rows than the endpoint's `limit 50`, which means Postgres can
            // never satisfy the limit early and must run the predicate over the whole table — the honest
            // worst case, and the realistic support case ("find this one user"). A high-cardinality needle
            // such as `warm-` would instead be satisfied by the first 50 heap rows (the warm users are
            // inserted first), short-circuiting the scan and reporting a fast p95 for a scan that never
            // happened.
            adminSearch: {
                /** Matches ZERO rows ⇒ guaranteed full scan, independent of seed size or heap order. */
                emailMissNeedle: 'no-such-user-zzzz',
                /** Matches exactly the admin row ⇒ proves the filter still RETURNS data, not just 200s. */
                emailHitNeedle: admin.email.split('@')[0],
                /**
                 * `?name=` variant — the same scan against `users.name`.
                 *
                 * The admin's OWN display name, matching exactly one row. Deliberately NOT
                 * `POOL_NAME_NEEDLE`: that matches every warm principal, i.e. exactly
                 * `IDENTITY_WARM_POOL_SIZE` (50) rows — and since the warm users are inserted FIRST they sit
                 * at the head of the heap, so Postgres satisfies the endpoint's `limit 50` within the first
                 * ~50 tuples and stops. Measured: 3.6ms versus 9.9ms for the scanning variants, i.e. it was
                 * reporting a short-circuit as though it were a scan.
                 */
                nameNeedle: admin.displayName,
                /** `?sub=` is `eq(users.id, …)` — a PRIMARY KEY probe. The indexed contrast to the scans. */
                exactUserId: admin.userId,
            },
        },
        null,
        2,
    ),
    'utf-8',
);

console.log(
    `prepare-clerk-tokens: wrote ${warm.length} warm + ${cold.length} cold + 1 admin + ` +
        `${Object.keys(reject).length} rejection tokens (azp=${AZP}, ttl=${TTL_SECONDS}s) and ` +
        `clerk-public-key.pem to ${outDir}`,
);
