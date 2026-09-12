/**
 * Mint the EdDSA service-erasure tokens the k6 `serviceErasure.load.js` scenario presents (CR-002 / U4a).
 *
 * WHY a prepare step (not minting inside k6): the erasure route is guarded by an asymmetric EdDSA signature
 * (`ServiceErasureGuard` → `ServiceErasureAuthService`), and k6's goja runtime cannot sign Ed25519. So —
 * exactly as `prepare-db.mjs` seeds the DB and `prepareVersionArchiveFixture.ts` seeds S3 BEFORE the k6
 * run — this step mints the tokens with `jose` (the same library the production signer and the integration
 * suite use) against the SHARED wire contract in `@kitchensink/recipe-core`, so a load token is byte-for-byte
 * what the real deletion-worker mints and drives the REAL verifier end to end. k6 then loads the pool via
 * `open()`; it never touches crypto. Run via `tsx` (it imports the workspace `@kitchensink/recipe-core`),
 * mirroring `prepareVersionArchiveFixture.ts`.
 *
 * It emits TWO artifacts next to the k6 script:
 *   - `erasure-public-key.pem` — the SPKI public key the service under test must trust
 *     (`RECIPE_SERVICE_PRINCIPAL_JWT_KEY`). A fresh throwaway keypair is generated each run.
 *   - `erasure-tokens.json` — `{ audience, ttlSeconds, valid: string[], expired: string }`. Each `valid`
 *     token is SINGLE-TARGET, bound to a DISTINCT synthetic owner ULID, so the load drives per-owner writes
 *     against non-existent owners (no real data is touched). `expired` drives the 401-under-load check.
 *
 * TTL: tokens are minted at the contract max window (120s) so a default-shaped run (≈105s) stays inside one
 * lifetime. A longer run must re-run this step — single-target, seconds-lived tokens are the security
 * contract (deliberately not long-lived).
 *
 * Usage (from packages/services/recipe-service):
 *   npx tsx tests/load/prepareErasureTokens.ts
 *   ERASURE_TOKEN_POOL_SIZE=500 npx tsx tests/load/prepareErasureTokens.ts
 *
 * @sideEffect Draws from the system CSPRNG and writes two files next to this script.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT, type CryptoKey } from 'jose';
import {
    buildServiceErasureJwtClaims,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
} from '@kitchensink/recipe-core';

const outDir = dirname(fileURLToPath(import.meta.url));
const AUDIENCE = SERVICE_ERASURE_TOKEN_AUDIENCE;
const POOL_SIZE = Math.max(1, Number(process.env['ERASURE_TOKEN_POOL_SIZE'] ?? 200));
// Cap at the contract max — the verifier rejects a window wider than this regardless of `exp`.
const TTL_SECONDS = Math.min(
    Number(process.env['ERASURE_TOKEN_TTL_SECONDS'] ?? SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS),
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
);

/**
 * A synthetic, ULID-shaped owner id (26 chars) for load — deliberately NON-EXISTENT so an erase is a
 * harmless no-op that never touches real data. Mirrors the CI dev-user id shape (`01JLOAD…`). Pure.
 */
const syntheticOwnerId = (index: number): string => `01JLOADERASE${String(index).padStart(14, '0')}`;

/** Sign one single-target erasure token for `ownerId`, `ttlSeconds` from `iat` (negative ⇒ already expired). */
const sign = (privateKey: CryptoKey, ownerId: string, ttlSeconds: number): Promise<string> => {
    const iat = Math.floor(Date.now() / 1000);
    const claims = buildServiceErasureJwtClaims({ ownerId, eventId: `load:${ownerId}`, actor: 'recipe-load-test' });

    return new SignJWT({ evt: claims.evt, act: claims.act })
        .setProtectedHeader({ alg: SERVICE_ERASURE_TOKEN_ALG })
        .setSubject(claims.sub)
        .setIssuer(SERVICE_ERASURE_TOKEN_ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ttlSeconds)
        .sign(privateKey);
};

const { publicKey, privateKey } = await generateKeyPair(SERVICE_ERASURE_TOKEN_ALG, {
    crv: 'Ed25519',
    extractable: true,
});
// Round-trip the private key through PKCS#8 so this exercises the exact import the real signer uses.
const signingKey = await importPKCS8(await exportPKCS8(privateKey), SERVICE_ERASURE_TOKEN_ALG);

const valid: string[] = [];

for (let i = 0; i < POOL_SIZE; i += 1) {
    valid.push(await sign(signingKey, syntheticOwnerId(i), TTL_SECONDS));
}

const expired = await sign(signingKey, syntheticOwnerId(POOL_SIZE), -60);

writeFileSync(join(outDir, 'erasure-public-key.pem'), await exportSPKI(publicKey), 'utf-8');
writeFileSync(
    join(outDir, 'erasure-tokens.json'),
    JSON.stringify({ audience: AUDIENCE, ttlSeconds: TTL_SECONDS, valid, expired }, null, 2),
    'utf-8',
);

console.log(
    `prepare-erasure-tokens: wrote ${valid.length} valid + 1 expired token (aud=${AUDIENCE}, ttl=${TTL_SECONDS}s) ` +
        `and erasure-public-key.pem to ${outDir}`,
);
