/**
 * Mint the Clerk session tokens the food-service performance k6 scripts present — WITHOUT touching a live
 * Clerk instance.
 *
 * WHY a prepare step. Every `/api/v1/foods/*` route is fronted by `FoodAuthGuard`, which verifies an
 * RS256 Clerk session token networklessly against a pinned public PEM (`CLERK_JWT_KEY`) and enforces
 * `azp`. Two consequences, identical to identity's `prepareClerkTokens.ts`:
 *
 *  1. k6's goja runtime cannot sign RS256, so the tokens must be minted outside k6 and loaded via
 *     `open()` — the same shape as this directory's `prepareErasureTokens.ts` (EdDSA).
 *  2. Because verification is networkless against a key WE choose, a throwaway keypair suffices. The
 *     service under test is booted with the public half, so every request drives the REAL guard, the REAL
 *     verifier and the REAL `azp` boundary with ZERO requests to Clerk. That is load-bearing, not
 *     incidental: the shared sandbox Clerk dev instance is a single per-IP rate limit, and minting a pool
 *     from one runner trips a multi-minute cool-down that turns CI red for reasons unrelated to food's
 *     performance (see `packages/tools/loadtest/README.md`). Do NOT "improve" this by using real tokens.
 *
 * It emits two artifacts next to the k6 scripts, both GITIGNORED credential material:
 *   - `clerk-public-key.pem` — the SPKI public key the food-service under test must be booted with
 *     (`CLERK_JWT_KEY`). A fresh throwaway keypair every run; the private half never leaves this process.
 *   - `clerk-tokens.json` — `{ azp, ttlSeconds, users: string[] }`. One token per synthetic principal; the
 *     scripts rotate through the pool by scenario iteration.
 *
 * Each token carries an `external_id` (an app-user ULID). The read/search paths this suite measures do
 * NOT need it — only the enqueue paths do (`FoodsController.requireRequesterId` answers `401
 * IDENTITY_SYNC_PENDING` without one) — but a token that could not enqueue would be a subtly different
 * principal from the one production serves, so the pool mints the realistic shape.
 *
 * Usage (from packages/services/food-service):
 *   npm run test:load:tokens
 *   FOOD_TOKEN_POOL_SIZE=200 npm run test:load:tokens
 *
 * @sideEffect Draws from the system CSPRNG, reads the clock, and writes two files next to this script.
 */
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newFoodId } from '../../src/db/ulid.js';

const outDir = dirname(fileURLToPath(import.meta.url));

/**
 * The `azp` every minted token claims. The service under test is booted with
 * `CLERK_AUTHORIZED_PARTIES=<this>`, i.e. EXACT-MATCH list mode — the production posture (ADR-0001: prod
 * is a single origin with exact-match `azp`; only sandbox previews use the anchored pattern). Under the
 * reserved `.test` TLD so it can never be confused with a deployed origin.
 */
const AZP = process.env['FOOD_LOAD_AZP'] ?? 'https://food-load.test';

/**
 * Token lifetime. `@clerk/backend` enforces `exp`/`nbf`/`iat` but caps no maximum lifetime, so an hour
 * removes the expiry-flake class entirely — the pool is minted once and reused across all three scripts
 * plus the 50,000-row seed that runs between them. (The EdDSA erasure pool is different: its 120s cap is
 * a contract maximum, which is why that run has a shortened shape.)
 */
const TTL_SECONDS = Math.max(60, Number(process.env['FOOD_TOKEN_TTL_SECONDS'] ?? 3600));

/**
 * Distinct principals in the pool. Food's read/search paths hold NO per-principal state (no read-through
 * provisioning, no per-user rows on a read), so unlike identity's warm pool this does not have to exceed
 * the peak VU count — it exists so the measured traffic is not one `sub` repeated, which would be an
 * unrealistically cache-friendly shape for any future per-principal work.
 */
const POOL_SIZE = Math.max(1, Number(process.env['FOOD_TOKEN_POOL_SIZE'] ?? 50));

/** A throwaway RSA keypair: the SPKI public PEM (the `CLERK_JWT_KEY`) and its PKCS#8 private PEM. */
interface ClerkKeypair {
    readonly publicKeyPem: string;
    readonly privateKeyPem: string;
}

/** The claims a minted token carries. */
interface MintOptions {
    /** The Clerk subject. */
    readonly sub: string;
    /** The app-user ULID emitted as `external_id` — THE requester key for enqueue paths (CR-002/U1/R5). */
    readonly externalId: string;
    /** The authorized party. */
    readonly azp: string;
    /** Seconds until expiry. */
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
 * @param options - Subject, requester ULID, authorized party and expiry window.
 * @returns A signed `header.payload.signature` bearer token.
 * @sideEffect Reads the system clock and signs with the private key.
 */
function mintToken(privateKeyPem: string, options: MintOptions): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: 'food-load' };
    const payload = {
        sub: options.sub,
        external_id: options.externalId,
        azp: options.azp,
        iat: nowSeconds,
        nbf: nowSeconds - 5,
        exp: nowSeconds + options.expiresInSeconds,
        // No scopes: none of the measured routes is admin-scoped (`/refetch` is, and is out of scope —
        // it burns source budget by design, so it has no place in a no-source-call performance suite).
        public_metadata: { scopes: [], permissions: [] },
    };

    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem).toString('base64url');

    return `${signingInput}.${signature}`;
}

const keypair = generateClerkKeypair();

const users: string[] = [];

for (let index = 0; index < POOL_SIZE; index += 1) {
    users.push(
        mintToken(keypair.privateKeyPem, {
            sub: `user_foodload${String(index).padStart(6, '0')}`,
            externalId: newFoodId(),
            azp: AZP,
            expiresInSeconds: TTL_SECONDS,
        }),
    );
}

writeFileSync(join(outDir, 'clerk-public-key.pem'), keypair.publicKeyPem, 'utf-8');
writeFileSync(join(outDir, 'clerk-tokens.json'), JSON.stringify({ azp: AZP, ttlSeconds: TTL_SECONDS, users }), 'utf-8');

// Counts and configuration only — NEVER token material. CI logs are public and so is this repo.
console.log(
    `prepare-clerk-tokens: wrote ${users.length} session token(s) (azp=${AZP}, ttl=${TTL_SECONDS}s) and ` +
        `clerk-public-key.pem to ${outDir}. Boot the service under test with ` +
        `CLERK_JWT_KEY="$(cat tests/load/clerk-public-key.pem)" CLERK_AUTHORIZED_PARTIES=${AZP}`,
);
