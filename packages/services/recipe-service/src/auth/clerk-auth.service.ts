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
import { resolveAzpEnforcement, verifyClerkToken, type VerifiedClerkClaims } from '@kitchensink/clerk-verify';

@Injectable()
export class ClerkAuthService {
    /** Public PEM verification key (non-secret); absence fails closed. Read once at construction. */
    private readonly jwtKey: string | undefined;
    /** Resolved `azp` enforcement — exact-match list OR a per-PR preview pattern. Read once. */
    private readonly azp: ReturnType<typeof resolveAzpEnforcement>;

    public constructor() {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.azp = resolveAzpEnforcement({
            authorizedPartiesRaw: process.env['CLERK_AUTHORIZED_PARTIES'],
            previewBaseDomain: process.env['CLERK_AZP_PATTERN'],
            // Cutover selector (ADR-0001): `transition` also admits the path-routed apex origin while the
            // shared sandbox migrates to per-PR subdomains; unset/anything-else stays strict (subdomain-only).
            previewMode: process.env['CLERK_AZP_PREVIEW_MODE'],
            // Admit azp-less native-app tokens (`client_type: 'native'`) in pattern mode — the mobile app
            // mints them via the `commise-native` Clerk JWT template (no browser origin ⇒ no `azp`). Gated
            // by env so only stages fronting a native client enable it; the security signal lives once in
            // clerk-verify's `isNativeClientToken`, never on azp-absence alone.
            admitNativeClient: process.env['CLERK_ADMIT_NATIVE_CLIENT'] === 'true',
        });
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
            return await verifyClerkToken(token, { jwtKey: this.jwtKey, ...this.azp });
        } catch {
            throw new UnauthorizedException();
        }
    }
}
