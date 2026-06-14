import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

/**
 * The subset of Clerk session-token claims the identity service reads. `email`/`firstName`/
 * `lastName` are present only when the instance's session token is customized to include them
 * (Dashboard → Sessions → Customize session token); they are optional here and the read-through
 * path tolerates their absence.
 */
export interface VerifiedClerkClaims {
    sub: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    picture?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseAuthorizedParties(raw: string | undefined): string[] {
    return (raw ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/**
 * Verifies Clerk session tokens networklessly using the instance's public JWT key (no Clerk secret
 * key, no JWKS network call). Wraps `@clerk/backend`'s `verifyToken`, which validates signature,
 * expiry (5s default clock skew), issuer, and the `azp` claim against `authorizedParties`.
 *
 * Configuration is read once at construction from `CLERK_JWT_KEY` (PEM public key) and
 * `CLERK_AUTHORIZED_PARTIES` (comma-separated allowed origins). The env schema requires both on
 * deployed stages; in dev/test this service is typically mocked.
 */
@Injectable()
export class ClerkAuthService {
    private readonly jwtKey: string | undefined;
    private readonly authorizedParties: string[];

    constructor() {
        this.jwtKey = process.env['CLERK_JWT_KEY'];
        this.authorizedParties = parseAuthorizedParties(process.env['CLERK_AUTHORIZED_PARTIES']);
    }

    /**
     * Verify a Clerk session JWT and return the claims we read. Any verification failure — bad
     * signature, expiry, wrong `azp`, malformed token, or missing key — maps to a 401 with a
     * generic message so the reason is never leaked to the caller.
     */
    async verify(token: string): Promise<VerifiedClerkClaims> {
        if (!this.jwtKey) {
            throw new UnauthorizedException();
        }

        let result: Awaited<ReturnType<typeof verifyToken>>;

        try {
            result = await verifyToken(token, {
                jwtKey: this.jwtKey,
                // Pass undefined (skip the azp check) only when no parties are configured — which on
                // deployed stages the env schema forbids. Never pass [] (Clerk treats it as "reject all").
                authorizedParties: this.authorizedParties.length > 0 ? this.authorizedParties : undefined,
            });
        } catch {
            throw new UnauthorizedException();
        }

        if (result.errors || !result.data) {
            throw new UnauthorizedException();
        }

        const payload = result.data as unknown as Record<string, unknown>;
        const sub = asNonEmptyString(payload['sub']);

        if (!sub) {
            throw new UnauthorizedException();
        }

        return {
            sub,
            email: asNonEmptyString(payload['email']),
            firstName: asNonEmptyString(payload['first_name']),
            lastName: asNonEmptyString(payload['last_name']),
            picture: asNonEmptyString(payload['image_url']) ?? asNonEmptyString(payload['picture']),
        };
    }
}
