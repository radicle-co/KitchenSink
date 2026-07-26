/**
 * The **producer (signer)** half of the service-erasure token wire contract (CR-002 / U4b).
 *
 * The identity deletion-worker (and the erasure-reconciliation sweep) is the ONLY holder of the EdDSA
 * PRIVATE key. On an erasure it mints a short-lived, single-target JWT and presents it as a bearer to the
 * recipe- and food-service internal erasure routes, which verify it NETWORKLESSLY against the matching
 * PUBLIC key. Everything package-crossing — the algorithm, the issuer, the claim names — comes from
 * {@link import('@kitchensink/recipe-core').buildServiceErasureJwtClaims} so this signer cannot drift from
 * the U4a verifier that reads it. The only per-call variables are the target `ownerId`, the correlation
 * `eventId`, the `actor`, and the **audience** (which binds the token to exactly one target service — see
 * {@link SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD}).
 *
 * `jose` (already a dependency) does the crypto — never hand-rolled.
 */
import { SignJWT, importPKCS8 } from 'jose';
import {
    buildServiceErasureJwtClaims,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
} from '@kitchensink/recipe-core';

/**
 * The default token lifetime (seconds). Single-request, single-target — seconds, not minutes — and well
 * inside {@link SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS} so the verifier's defense-in-depth window cap never
 * rejects a legitimately-minted token, while a leaked one is useless in under a minute.
 */
export const SERVICE_ERASURE_TOKEN_DEFAULT_TTL_SECONDS = 60;

/** The inputs to {@link mintServiceErasureToken}. */
export interface MintServiceErasureTokenInput {
    /** The EdDSA PRIVATE signing key, PKCS#8 PEM. Held ONLY by the deletion-worker/reconciliation Lambda. */
    readonly privateKeyPem: string;
    /**
     * The target service's pinned `aud` — recipe's ({@link SERVICE_ERASURE_TOKEN_AUDIENCE}) or food's
     * ({@link SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD}). Binds this token to exactly one leg.
     */
    readonly audience: string;
    /** The bound target: the app-user ULID whose data this ONE token authorizes erasing (→ JWT `sub`). */
    readonly ownerId: string;
    /** The correlation/event id (single-event binding) (→ JWT `evt`). */
    readonly eventId: string;
    /** The machine actor label recorded as `account_erasure_jobs.actor` (R8) (→ JWT `act`). */
    readonly actor: string;
    /** Optional TTL override (seconds); CAPPED at {@link SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS}. */
    readonly ttlSeconds?: number;
    /** Optional clock injection (tests). Defaults to `new Date()`. */
    readonly now?: Date;
}

/**
 * Mint a signed, single-target service-erasure token bound to `ownerId` for the given `audience`.
 *
 * The protected header pins {@link SERVICE_ERASURE_TOKEN_ALG}; the registered claims are
 * {@link SERVICE_ERASURE_TOKEN_ISSUER}, the caller's `audience`, `iat`, and a short `exp`; the custom
 * claims (`sub`/`evt`/`act`) come from {@link buildServiceErasureJwtClaims}. A requested `ttlSeconds` above
 * the contract cap is clamped DOWN — the signer can never widen the capability window past the verifier's
 * bound.
 *
 * @param input - The private key, target audience, bound owner/event/actor, and optional TTL/clock.
 * @returns The compact JWS string to send as `Authorization: Bearer …`.
 * @sideEffect None beyond the in-process signature computation (no network, no I/O).
 */
export async function mintServiceErasureToken(input: MintServiceErasureTokenInput): Promise<string> {
    const ttlSeconds = Math.min(
        input.ttlSeconds ?? SERVICE_ERASURE_TOKEN_DEFAULT_TTL_SECONDS,
        SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
    );
    const issuedAt = Math.floor((input.now?.getTime() ?? Date.now()) / 1000);
    const claims = buildServiceErasureJwtClaims({
        ownerId: input.ownerId,
        eventId: input.eventId,
        actor: input.actor,
    });
    const key = await importPKCS8(input.privateKeyPem, SERVICE_ERASURE_TOKEN_ALG);

    // `claims` already carries `sub` (the contract's authoritative mapping), so it rides in the payload
    // body — no separate `.setSubject()`. `evt`/`act` are custom claims the verifier reads back.
    return new SignJWT({ ...claims })
        .setProtectedHeader({ alg: SERVICE_ERASURE_TOKEN_ALG })
        .setIssuer(SERVICE_ERASURE_TOKEN_ISSUER)
        .setAudience(input.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .sign(key);
}
