/**
 * Real Clerk-compatible RS256 JWT minting for the food-service e2e suite (T-190).
 *
 * The e2e boots the real Nest app with the REAL {@link FoodAuthGuard} → `@kitchensink/clerk-verify`
 * (no mock), so it needs genuinely-signed tokens that `@clerk/backend`'s networkless `verifyToken`
 * accepts against a pinned PEM public key. We generate a throwaway 2048-bit RSA keypair: Clerk's local
 * JWK loader strips the fixed SPKI prefix `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA` and assumes
 * `e = AQAB` (65537), which is exactly a Node `modulusLength: 2048` SPKI public key — so the exported
 * PEM works verbatim as `CLERK_JWT_KEY`. Tokens are signed locally with the matching private key; no
 * Clerk network call, no secret key, fully hermetic.
 *
 * Authorization grants live ONLY in the signed `public_metadata` (the same place the production guard
 * reads `scopes`/`permissions` from), never a top-level claim.
 */
import crypto from 'node:crypto';

/** A throwaway RSA keypair: the SPKI public PEM (the `CLERK_JWT_KEY`) and its PKCS#8 private PEM. */
export interface ClerkKeypair {
    /** SPKI public-key PEM — set as `CLERK_JWT_KEY` so the guard verifies networklessly. */
    readonly publicKeyPem: string;
    /** PKCS#8 private-key PEM — used to sign minted tokens (test-only, never shipped). */
    readonly privateKeyPem: string;
}

/** Options for {@link mintToken}. */
export interface MintTokenOptions {
    /** The Clerk subject (the authenticated principal id) — required. */
    readonly sub: string;
    /** The authorized party the token is minted for (must be in `CLERK_AUTHORIZED_PARTIES`). */
    readonly azp?: string;
    /** Authorization scopes embedded in `public_metadata` (e.g. `['food:admin']`). */
    readonly scopes?: readonly string[];
    /** Authorization permissions embedded in `public_metadata`. */
    readonly permissions?: readonly string[];
    /** Seconds until expiry (default 3600). Use a negative value to mint an already-expired token. */
    readonly expiresInSeconds?: number;
}

/** Base64url-encode a UTF-8 string. Pure. */
function base64Url(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Generate a throwaway 2048-bit RSA keypair for the e2e auth path.
 *
 * @returns The SPKI public PEM (the `CLERK_JWT_KEY`) and its PKCS#8 private PEM.
 * @sideEffect Draws from the system CSPRNG.
 */
export function generateClerkKeypair(): ClerkKeypair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/**
 * Mint a Clerk-compatible RS256 JWT signed with `privateKeyPem`. The token carries the standard
 * `sub`/`azp`/`iat`/`nbf`/`exp` claims `@clerk/backend` validates, plus the signed `public_metadata`
 * grants the production guard reads.
 *
 * @param privateKeyPem - The signing key (from {@link generateClerkKeypair}).
 * @param options - The subject, authorized party, grants, and expiry window.
 * @returns A signed `header.payload.signature` bearer token.
 * @sideEffect Reads the system clock for `iat`/`nbf`/`exp` and signs with the private key.
 */
export function mintToken(privateKeyPem: string, options: MintTokenOptions): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: 'local' };
    const payload = {
        sub: options.sub,
        azp: options.azp,
        iat: nowSeconds,
        nbf: nowSeconds - 5,
        exp: nowSeconds + (options.expiresInSeconds ?? 3600),
        public_metadata: {
            scopes: [...(options.scopes ?? [])],
            permissions: [...(options.permissions ?? [])],
        },
    };

    const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKeyPem).toString('base64url');

    return `${signingInput}.${signature}`;
}
