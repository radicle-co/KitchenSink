/**
 * MOD-001 — `ClerkAuthService`: networkless Clerk session-token verification for the recipe service.
 *
 * Thin, injectable wrapper over the shared `@kitchensink/clerk-verify` verifier (one implementation
 * shared with identity/food so they cannot drift). Verification uses the instance's public
 * `CLERK_JWT_KEY` (PEM) and the `CLERK_AUTHORIZED_PARTIES` `azp` allowlist — no Clerk secret key and
 * no JWKS network round-trip. Any verification failure (missing key, bad signature, expiry, wrong
 * `azp`, malformed token, missing `sub`) is mapped to an opaque `401` so the reason never leaks.
 *
 * This service does NOT enforce owner-identity presence: the shared verifier leaves `userId`
 * (the app-user ULID from `external_id`) **undefined** when the claim is absent and delegates the
 * fail-closed decision to per-service policy. That enforcement lives in {@link
 * import('./auth.middleware.js').AuthMiddleware} (T019), the recipe service's enforcement point.
 *
 * There is deliberately **no** `resolveOrCreateFromClaims`, no read-through user creation, and no
 * local `users` table — recipe ownership is keyed solely on the verified `userId` ULID.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyClerkToken, type VerifiedClerkClaims } from '@kitchensink/clerk-verify';

/** Parse a comma-separated allowlist (the `azp` parties) into a trimmed, non-empty list. Pure. */
function parseCommaList(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

@Injectable()
export class ClerkAuthService {
    /** Public PEM verification key (non-secret); absence fails closed. Read once at construction. */
    private readonly jwtKey: string | undefined;
    /** The `azp` allowlist (non-secret). Read once at construction. */
    private readonly authorizedParties: string[];

    public constructor() {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.authorizedParties = parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES']);
    }

    /**
     * Verify a Clerk session JWT networklessly and return the verified claims.
     *
     * @param token - The raw bearer token.
     * @returns The verified claims (`userId` present only when the token carries `external_id`).
     * @throws {UnauthorizedException} (→ 401) on ANY verification failure — the underlying reason is
     *   never surfaced to the caller.
     * @sideEffect None beyond the in-process signature check — no network call (jwtKey, not secretKey).
     */
    public async verify(token: string): Promise<VerifiedClerkClaims> {
        try {
            return await verifyClerkToken(token, {
                jwtKey: this.jwtKey,
                authorizedParties: this.authorizedParties,
            });
        } catch {
            throw new UnauthorizedException();
        }
    }
}
