/**
 * `ServiceErasureAuthService` — networkless verification of the GREENFIELD service-principal
 * account-erasure token (CR-002 / U4a).
 *
 * The recipe service has never had a machine principal. This is that principal's verifier, deliberately
 * built to MIRROR the trusted Clerk posture ({@link import('./clerk-auth.service.js').ClerkAuthService}):
 * an ASYMMETRIC signature verified against a dedicated PUBLIC key
 * (`RECIPE_SERVICE_PRINCIPAL_JWT_KEY`), in-process, with no secret on this public-ALB service and no
 * network round-trip. The signer (the identity deletion-worker Lambda, U4b) holds the private key; a
 * compromise of THIS service cannot forge a token.
 *
 * Every check that makes the capability event-bound rather than ambient lives here, and every failure is
 * mapped to an opaque `401` so the reason never leaks:
 *
 *  - **Algorithm pinned** to {@link SERVICE_ERASURE_TOKEN_ALG} — an `alg: none` token or an
 *    algorithm-confusion swap (an `HS256` token signed with the public PEM as an HMAC secret) is rejected.
 *  - **Issuer + audience pinned** to the shared contract — a token minted for any other issuer/endpoint
 *    cannot be replayed against recipe erasure.
 *  - **Expiry + a max-window cap** — `jose` rejects an expired token; on top of that, a token whose
 *    lifetime (`exp - iat`) exceeds {@link SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS} is rejected even if not
 *    yet expired, bounding a leaked token's usefulness regardless of when it is presented.
 *  - **Custom claims required** — a cryptographically-valid token missing `sub`/`evt`/`act` is rejected
 *    rather than yielding a principal with an empty owner key.
 *
 * The bound target `ownerId` is read from the token's `sub`; it is the ONLY thing that scopes the erasure,
 * and it can never be overridden by a request body/query (there is no such input on the service route).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { importSPKI, jwtVerify, type CryptoKey, type JWTPayload } from 'jose';
import {
    parseServiceErasureClaims,
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_ISSUER,
    SERVICE_ERASURE_TOKEN_MAX_TTL_SECONDS,
} from '@kitchensink/recipe-core';

import type { ServicePrincipal } from './service-principal.js';

/** Clock-skew tolerance (seconds) allowed on `exp`/`iat`, matching typical short-lived-token verification. */
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class ServiceErasureAuthService {
    /**
     * The imported public verification key, resolved once at construction. `undefined` when the env key is
     * absent, which makes {@link verify} fail closed (reject every token) rather than boot a stage that
     * silently accepts nothing OR — worse — anything. Held as a Promise because `importSPKI` is async;
     * awaited per verification (cheap, and Node caches nothing we must manage).
     */
    private readonly publicKey: Promise<CryptoKey> | undefined;

    public constructor() {
        const pem = process.env['RECIPE_SERVICE_PRINCIPAL_JWT_KEY'];

        // Import eagerly so a malformed PEM surfaces at boot (via the rejected promise on first verify),
        // not silently. Absent key ⇒ undefined ⇒ fail-closed in verify().
        this.publicKey = pem !== undefined && pem.length > 0 ? importSPKI(pem, SERVICE_ERASURE_TOKEN_ALG) : undefined;
    }

    /**
     * Verify a service-principal erasure token and return the bound {@link ServicePrincipal}.
     *
     * @param token - The raw bearer token.
     * @returns The verified principal — the bound target owner, event id, and actor, all from the token.
     * @throws {UnauthorizedException} (→ 401) on ANY failure: no key configured, bad signature, wrong
     *   algorithm/issuer/audience, expired or over-window, or missing custom claims. The reason is never
     *   surfaced to the caller.
     * @sideEffect None beyond the in-process signature check — no network call (public key, not a secret).
     */
    public async verify(token: string): Promise<ServicePrincipal> {
        if (this.publicKey === undefined) {
            // Fail closed: a stage without the verification key provisioned rejects every service token.
            throw new UnauthorizedException();
        }

        let payload: JWTPayload;

        try {
            const key = await this.publicKey;
            ({ payload } = await jwtVerify(token, key, {
                algorithms: [SERVICE_ERASURE_TOKEN_ALG],
                issuer: SERVICE_ERASURE_TOKEN_ISSUER,
                audience: SERVICE_ERASURE_TOKEN_AUDIENCE,
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
 * mis-minted far-future `exp`, and it requires both timestamps to be present.
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
