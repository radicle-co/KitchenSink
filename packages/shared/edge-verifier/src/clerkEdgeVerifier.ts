/**
 * The production wiring of the Lambda@Edge viewer-request verifier: the decision layer in `./edgeVerifier.ts`
 * composed with the repository's EXISTING networkless Clerk verification and the shared CORS policy.
 *
 * DESIGN PATTERN: **Adapter**. Nothing is decided here — `createEdgeVerifier` owns the ordering, the
 * passthrough list, the `401` and the cache partition. This module satisfies the injected `EdgeTokenVerifier` port
 * with `@kitchensink/clerk-verify`, the same implementation the identity, food and recipe services verify with, and
 * resolves the CORS options with `resolveCorsPolicy`, the policy those services install. Neither is re-derived at
 * the edge: a second implementation would drift from the origins that must agree with it.
 *
 * It is the one module of this package that loads `@clerk/backend`. `./edgeRoutes.ts`, which `EdgeStack` reads at
 * synth, imports nothing.
 *
 * ## `azp` is NOT enforced here, deliberately
 *
 * Each origin enforces its own `azp` boundary from the same signed claim (`resolveAzpEnforcement`), and it
 * is the origin that knows its stage's policy — prod's exact-match list, sandbox's anchored pattern
 * (ADR-0001). The edge's job is narrower: refuse a token that is not currently valid at all, and partition the
 * cache per principal. A token valid for another authorized party still belongs to a real principal, so it gets
 * its own partition and is then refused by the origin — no cache entry is shared and no authorization decision is
 * taken here.
 *
 * The party list IS compiled in, for one purpose: the CORS headers on the edge's own `401`. So a change to prod's
 * `/clerk/authorized-parties` reaches the edge only when the edge bundle is rebuilt, as a key rotation does
 * (ADR-0020's runbook). Until then a newly listed origin reads the edge's `401` as a network error, and a delisted
 * one can still read a `401` that carries nothing but `{ code, message }`.
 *
 * @module
 */
import { resolveCorsPolicy, verifyClerkToken } from '@kitchensink/clerk-verify';

import { createEdgeVerifier, type EdgePrincipal } from './edgeVerifier.js';

/** The build-time inputs of the production edge. */
export interface ClerkEdgeVerifierConfig {
    /** The Clerk instance's PEM public JWT key. */
    readonly jwtKey: string;
    /** Raw `CLERK_AUTHORIZED_PARTIES` (comma-separated), from the SSM parameter the prod origins read. */
    readonly authorizedPartiesRaw: string;
}

/**
 * Build the viewer-request handler for one Clerk instance and one authorized-party list.
 *
 * Both inputs are compiled into the bundle at build time, because Lambda@Edge cannot read environment variables
 * (ADR-0020 trap 6).
 *
 * @param config - The key and the party list.
 * @returns The Lambda@Edge viewer-request handler.
 * @sideEffect None of its own; the returned handler mutates the request headers it is given.
 */
export function createClerkEdgeVerifier({
    jwtKey,
    authorizedPartiesRaw,
}: ClerkEdgeVerifierConfig): ReturnType<typeof createEdgeVerifier> {
    const { options } = resolveCorsPolicy({
        deployed: true,
        authorizedPartiesRaw,
        // The edge is prod-only (`EdgeStack` refuses any other stage), and prod admits an exact list.
        previewBaseDomain: undefined,
        previewMode: undefined,
        // One bundle answers for every fronted service, so it would grant credentials while any of them does; none
        // does. `packages/infra/global/__tests__/edgeCorsCredentials.test.ts` holds this to the OR over the adopters.
    });

    return createEdgeVerifier({
        verify: async (token: string): Promise<EdgePrincipal> => {
            // `authorizedParties: []` is how the shared verifier is told to skip the SDK's `azp` check (it is
            // never passed an empty array — Clerk reads that as "reject everything"). See the module doc.
            const claims = await verifyClerkToken(token, { jwtKey, authorizedParties: [] });

            return { sub: claims.sub, userId: claims.userId };
        },
        cors: options,
    });
}
