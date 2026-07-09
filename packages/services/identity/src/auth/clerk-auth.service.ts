import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyClerkToken, type VerifiedClerkClaims } from '@kitchensink/clerk-verify';

import { parseCommaList } from '../config/env.schema.js';

/**
 * Re-export the shared verified-claims shape so identity's consumers (notably
 * {@link import('../users/users.service.js').UsersService.resolveOrCreateFromClaims}) keep importing it
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
    /** The `azp` allowlist (non-secret). Read once at construction. */
    private readonly authorizedParties: string[];

    constructor() {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.authorizedParties = parseCommaList(process.env['CLERK_AUTHORIZED_PARTIES']);
    }

    /**
     * Verify a Clerk session JWT networklessly and return the verified claims. Any verification failure
     * — missing key, bad signature, expiry, wrong `azp`, malformed token, or missing `sub` — maps to a
     * 401 with a generic message so the underlying reason is never surfaced to the caller.
     */
    async verify(token: string): Promise<VerifiedClerkClaims> {
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
