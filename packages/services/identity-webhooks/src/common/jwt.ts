import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { ClerkSessionClaims } from '@commise/services-identity';

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

const getJWKS = () => {
    if (cachedJWKS) {
        return cachedJWKS;
    }

    const jwksUrl = process.env['IDP_JWKS_URL'];

    if (!jwksUrl) {
        throw new Error('IDP_JWKS_URL env var is required');
    }

    cachedJWKS = createRemoteJWKSet(new URL(jwksUrl), { cacheMaxAge: 3_600_000 });

    return cachedJWKS;
};

/** @implements REQ-038 REQ-039 REQ-040 REQ-041 REQ-042 REQ-IF-004 REQ-CN-001 FR-038 FR-039 FR-040 FR-041 FR-042 ARCH-024 ARCH-025 MOD-024 MOD-025 */
export const verifyClerkJwt = async (token: string): Promise<ClerkSessionClaims> => {
    const issuer = process.env['IDP_ISSUER'];

    if (!issuer) {
        throw new Error('IDP_ISSUER env var is required');
    }

    const { payload } = await jwtVerify(token, getJWKS(), { issuer });

    return payload as unknown as ClerkSessionClaims;
};
