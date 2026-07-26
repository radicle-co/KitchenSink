/**
 * `FoodServiceErasureAuthService` — networkless verification of the service-principal account-erasure token
 * for the food service (CR-002 / U4b / R11). The food mirror of recipe-service's U4a
 * `ServiceErasureAuthService`, verified against the SAME `@kitchensink/recipe-core` wire contract but
 * pinning the FOOD audience ({@link SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD}) — so a token minted for the
 * recipe leg cannot be replayed here, and vice versa.
 *
 * It MIRRORS the trusted Clerk posture: an ASYMMETRIC signature verified against a dedicated PUBLIC key
 * (`FOOD_SERVICE_PRINCIPAL_JWT_KEY`), in-process, with no secret on this public-ALB service and no network
 * round-trip. The signer (the identity deletion-worker / erasure-reconciliation Lambda) holds the private
 * key; a compromise of THIS service cannot forge a token.
 *
 * Every check that makes the capability event-bound rather than ambient lives here, and every failure maps
 * to an opaque `401`:
 *
 *  - **Algorithm pinned** to {@link SERVICE_ERASURE_TOKEN_ALG} — an `alg: none` or algorithm-confusion
 *    (an `HS256` token signed with the public PEM as an HMAC secret) is rejected.
 *  - **Issuer + audience pinned** — a token for any other issuer/endpoint (incl. the recipe leg) is rejected.
 *  - **Expiry + a max-window cap** — `jose` rejects an expired token; on top, a token whose lifetime
 *    (`exp - iat`) exceeds {@link SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS} is rejected even if not yet expired.
 *  - **Custom claims required** — a cryptographically-valid token missing `sub`/`evt`/`act` is rejected.
 *
 * The bound target `ownerId` is read from the token's `sub`; it is the ONLY thing scoping the erasure and
 * can never be overridden by a request body/query (the internal route has none).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { importSPKI, jwtVerify, type CryptoKey, type JWTPayload } from 'jose';
import {
    parseServiceErasureClaims,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
} from '@kitchensink/recipe-core';

import type { ServicePrincipal } from './service-principal.js';

/** Clock-skew tolerance (seconds) allowed on `exp`/`iat`, matching typical short-lived-token verification. */
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class FoodServiceErasureAuthService {
    /**
     * The imported public verification key, resolved once at construction. `undefined` when the env key is
     * absent, which makes {@link verify} fail closed (reject every token) rather than boot a stage that
     * silently accepts anything. Held as a Promise because `importSPKI` is async.
     */
    private readonly publicKey: Promise<CryptoKey> | undefined;

    public constructor() {
        const pem = process.env['FOOD_SERVICE_PRINCIPAL_JWT_KEY'];

        this.publicKey = pem !== undefined && pem.length > 0 ? importSPKI(pem, SERVICE_ERASURE_TOKEN_ALG) : undefined;
    }

    /**
     * Verify a service-principal erasure token and return the bound {@link ServicePrincipal}.
     *
     * @param token - The raw bearer token.
     * @returns The verified principal — the bound target owner, event id, and actor, all from the token.
     * @throws {UnauthorizedException} (→ 401) on ANY failure: no key configured, bad signature, wrong
     *   algorithm/issuer/audience, expired or over-window, or missing custom claims. The reason never leaks.
     * @sideEffect None beyond the in-process signature check — no network call (public key, not a secret).
     */
    public async verify(token: string): Promise<ServicePrincipal> {
        if (this.publicKey === undefined) {
            throw new UnauthorizedException();
        }

        let payload: JWTPayload;

        try {
            const key = await this.publicKey;
            ({ payload } = await jwtVerify(token, key, {
                algorithms: [SERVICE_ERASURE_TOKEN_ALG],
                issuer: SERVICE_ERASURE_TOKEN_ISSUER,
                audience: SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
                clockTolerance: CLOCK_TOLERANCE_SECONDS,
            }));
        } catch {
            throw new UnauthorizedException();
        }

        assertBoundedWindow(payload);

        try {
            return parseServiceErasureClaims(payload as Record<string, unknown>);
        } catch {
            throw new UnauthorizedException();
        }
    }
}

/**
 * Reject a token whose lifetime window (`exp - iat`) exceeds the max TTL, or that lacks `iat`/`exp`.
 * Defense-in-depth ON TOP OF `jose`'s expiry check: it bounds the capability window even against a
 * mis-minted far-future `exp`, and it requires both timestamps present.
 *
 * @param payload - The verified JWT payload.
 * @throws {UnauthorizedException} (→ 401) when `iat`/`exp` is missing or the window is too wide. Pure otherwise.
 */
function assertBoundedWindow(payload: JWTPayload): void {
    const { iat, exp } = payload;

    if (typeof iat !== 'number' || typeof exp !== 'number') {
        throw new UnauthorizedException();
    }

    if (exp - iat > SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS + CLOCK_TOLERANCE_SECONDS) {
        throw new UnauthorizedException();
    }
}
