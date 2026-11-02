import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
    ACCOUNT_SUSPENDED_CODE,
    ACCOUNT_SUSPENDED_MESSAGE,
    isClerkAccountSuspendedError,
    resolveAzpEnforcement,
    verifyClerkToken,
    type RequestTarget,
    type VerifiedClerkClaims,
} from '@kitchensink/clerk-verify';

/**
 * Re-export the shared verified-claims shape so identity's consumers (notably
 * `UsersService.resolveOrCreateFromClaims`) keep importing it
 * from here. The shared type is a SUPERSET of what identity reads — it adds `userId` (from `external_id`)
 * and `azp` — so nothing downstream changes; `scopes`/`permissions` are now non-optional `string[]`
 * (always defaulted to `[]`), which identity already produced.
 */
export type { VerifiedClerkClaims } from '@kitchensink/clerk-verify';

/**
 * Networkless Clerk session-token verification for the identity service.
 *
 * A thin, injectable wrapper over the shared `@kitchensink/clerk-verify` verifier — the ONE
 * implementation shared with the recipe and food services so the security-sensitive token handling
 * (signature/expiry/`azp`, and the `public_metadata`-only sourcing of `scopes`/`permissions`) cannot
 * drift between services (it previously had — the shared claims surface `userId`/`azp` that identity's
 * old inline copy lacked). Verification uses the instance's public `CLERK_JWT_KEY` (PEM) and the
 * `CLERK_AUTHORIZED_PARTIES` `azp` allowlist — no Clerk secret key, no JWKS network round-trip. Every
 * failure maps to an opaque `401` so the reason never leaks.
 *
 * Identity's read-through user creation (`resolveOrCreateFromClaims`) and its local `users` table are
 * unaffected — ONLY the token cracking is shared.
 */
@Injectable()
export class ClerkAuthService {
    /** Public PEM verification key (non-secret); absence fails closed. Read once at construction. */
    private readonly jwtKey: string | undefined;
    /** Resolved `azp` enforcement — exact-match list OR a per-PR preview pattern. Read once. */
    private readonly azp: ReturnType<typeof resolveAzpEnforcement>;

    constructor() {
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
     * Verify a Clerk session JWT networklessly and return the verified claims. Any verification failure
     * — missing key, bad signature, expiry, wrong `azp`, malformed token, or missing `sub` — maps to a
     * 401 with a generic message so the underlying reason is never surfaced to the caller.
     *
     * A genuine token for a SUSPENDED account is refused by the shared verifier (ADR-0081) and answered `403
     * ACCOUNT_SUSPENDED` here, except on the routes the verifier's allow-list names (erasure), which is why the
     * request is passed along.
     *
     * @param token - The raw bearer token.
     * @param request - The method and path it arrived on.
     * @throws UnauthorizedException on any verification failure; ForbiddenException for a suspended account.
     */
    async verify(token: string, request?: RequestTarget): Promise<VerifiedClerkClaims> {
        try {
            return await verifyClerkToken(token, { jwtKey: this.jwtKey, ...this.azp }, request);
        } catch (error) {
            if (isClerkAccountSuspendedError(error)) {
                throw new ForbiddenException({ code: ACCOUNT_SUSPENDED_CODE, message: ACCOUNT_SUSPENDED_MESSAGE });
            }

            throw new UnauthorizedException();
        }
    }
}
