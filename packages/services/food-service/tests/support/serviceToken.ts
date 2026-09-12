/**
 * Hermetic minting of internal service-principal account-erasure tokens (CR-002 / U4b / R11) for the food
 * service's auth suites — the food mirror of recipe-service's `tests/support/serviceToken.ts`.
 *
 * The PRODUCTION signer is the identity deletion-worker / erasure-reconciliation Lambda (a different
 * package); this is its test-only stand-in. It generates a throwaway Ed25519 keypair and signs tokens with
 * `jose` against the SHARED wire contract in `@kitchensink/recipe-core`, defaulting to the FOOD audience —
 * so a test token is byte-for-byte what the real worker mints for the food leg, driving the food
 * `FoodServiceErasureAuthService.verify` end to end (no mocks). Every knob is overridable so the
 * negative-path suite can forge each rejection reason (including a recipe-audience token, which food MUST
 * reject).
 */
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from 'jose';
import {
    buildServiceErasureJwtClaims,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
    SERVICE_ERASURE_TOKEN_ISSUER,
} from '@kitchensink/recipe-core';

/** A throwaway Ed25519 keypair: the SPKI public PEM (verification key) + its PKCS#8 private PEM. */
export interface ServiceKeypair {
    /** SPKI public-key PEM — set as `FOOD_SERVICE_PRINCIPAL_JWT_KEY` so the verifier trusts this signer. */
    readonly publicKeyPem: string;
    /** PKCS#8 private-key PEM — used to sign minted tokens (test-only, never shipped). */
    readonly privateKeyPem: string;
}

/**
 * Generate a throwaway Ed25519 keypair for the service-principal auth path.
 *
 * @returns The SPKI public PEM and PKCS#8 private PEM.
 * @sideEffect Draws from the system CSPRNG.
 */
export async function generateServiceKeypair(): Promise<ServiceKeypair> {
    const { publicKey, privateKey } = await generateKeyPair(SERVICE_ERASURE_TOKEN_ALG, {
        crv: 'Ed25519',
        extractable: true,
    });

    return { publicKeyPem: await exportSPKI(publicKey), privateKeyPem: await exportPKCS8(privateKey) };
}

/** Options for {@link signServiceErasureToken} — sane FOOD defaults, each overridable to forge a rejection. */
export interface SignServiceTokenOptions {
    /** The bound target owner ULID (JWT `sub`) — required. */
    readonly ownerId: string;
    /** Correlation/event id (JWT `evt`). Defaults to a fixed value. */
    readonly eventId?: string;
    /** Machine actor label (JWT `act`). Defaults to the deletion-worker. */
    readonly actor?: string;
    /** Issuer override (defaults to the contract issuer) — set to forge a wrong-iss token. */
    readonly issuer?: string;
    /** Audience override (defaults to the FOOD audience) — set to recipe's to forge a wrong-aud token. */
    readonly audience?: string;
    /** JWS algorithm override (defaults to the contract algorithm). */
    readonly alg?: string;
    /** `iat` in epoch seconds (defaults to now). Move it back to forge an over-window token. */
    readonly issuedAtSeconds?: number;
    /** Seconds from `iat` to `exp` (defaults to 60). Negative ⇒ expired; large ⇒ over-window. */
    readonly expiresInSeconds?: number;
    /** Custom claims to OMIT (e.g. `['evt']`) — to test a verified-but-malformed token. */
    readonly omitClaims?: readonly ('evt' | 'act')[];
}

/**
 * Mint an internal service-erasure JWT signed with `privateKeyPem`, against the recipe-core wire contract
 * with the FOOD audience by default.
 *
 * @param privateKeyPem - The signing key (from {@link generateServiceKeypair}).
 * @param options - The bound owner + optional overrides to forge negative cases.
 * @returns A signed `header.payload.signature` bearer token.
 * @sideEffect Reads the system clock (unless `issuedAtSeconds` is given) and signs with the private key.
 */
export async function signServiceErasureToken(
    privateKeyPem: string,
    options: SignServiceTokenOptions,
): Promise<string> {
    const alg = options.alg ?? SERVICE_ERASURE_TOKEN_ALG;
    const key = await importPKCS8(privateKeyPem, alg);
    const iat = options.issuedAtSeconds ?? Math.floor(Date.now() / 1000);
    const exp = iat + (options.expiresInSeconds ?? 60);
    const claims = buildServiceErasureJwtClaims({
        ownerId: options.ownerId,
        eventId: options.eventId ?? 'evt_user_deleted_test',
        actor: options.actor ?? 'identity-deletion-worker',
    });

    const payload: Record<string, unknown> = { evt: claims.evt, act: claims.act };

    for (const omit of options.omitClaims ?? []) {
        delete payload[omit];
    }

    return new SignJWT(payload)
        .setProtectedHeader({ alg })
        .setSubject(claims.sub)
        .setIssuer(options.issuer ?? SERVICE_ERASURE_TOKEN_ISSUER)
        .setAudience(options.audience ?? SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD)
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key);
}
