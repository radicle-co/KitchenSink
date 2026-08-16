/**
 * The production wiring of the Lambda@Edge viewer-request verifier: the decision layer in
 * `lib/edge-verifier/` composed with the repository's EXISTING networkless Clerk verification.
 *
 * DESIGN PATTERN: **Adapter**. Nothing is decided here — `createEdgeVerifier` owns the ordering, the
 * passthrough list, the `401` and the cache partition. This module's only job is to satisfy the injected
 * `EdgeTokenVerifier` port with `@kitchensink/clerk-verify`, the same implementation the identity, food and
 * recipe services verify with. Nothing about Clerk verification is re-derived at the edge: a second
 * implementation would drift from the origins that must agree with it about what a valid token is.
 *
 * ## Why it lives under `src/` and not `lib/`
 *
 * `lib/` is the CDK app's EMIT project, compiled to `dist/` and run as plain JS by `node dist/bin/app.js` at
 * deploy time. `@kitchensink/clerk-verify` exports `./src/index.ts`, which node type-strips but cannot
 * resolve the relative `./x.js` imports of — ADR-0013's `ERR_MODULE_NOT_FOUND`. Keeping the Clerk dependency
 * on this side of the line means the deploy path can never load it. esbuild bundles this module (and Clerk)
 * into the edge asset, where the specifier is resolved at BUILD time and the question does not arise.
 *
 * ## `azp` is NOT enforced here, deliberately
 *
 * Each origin enforces its own `azp` boundary from the same signed claim (`resolveAzpEnforcement`), and it
 * is the origin that knows its stage's policy — prod's exact-match list, sandbox's anchored pattern
 * (ADR-0001). Baking a second copy of that policy into an edge bundle would give a Clerk key rotation and an
 * origin-allowlist change two independent deploy paths that must agree. The edge's job is narrower: refuse a
 * token that is not currently valid at all, and partition the cache per principal. A token valid for another
 * authorized party still belongs to a real principal, so it gets its own partition and is then refused by the
 * origin — no cache entry is shared and no authorization decision is taken here.
 *
 * @module
 */
import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { createEdgeVerifier, type EdgePrincipal } from '../../lib/edge-verifier/edgeVerifier.js';

/**
 * Build the viewer-request handler for one Clerk instance's public key.
 *
 * @param jwtKey - The instance's PEM public JWT key, compiled into the bundle at build time (Lambda@Edge
 *   cannot read environment variables — ADR-0020 trap 6).
 * @returns The Lambda@Edge viewer-request handler.
 * @sideEffect None of its own; the returned handler mutates the request headers it is given.
 */
export function createClerkEdgeVerifier(jwtKey: string): ReturnType<typeof createEdgeVerifier> {
    return createEdgeVerifier(async (token: string): Promise<EdgePrincipal> => {
        // `authorizedParties: []` is how the shared verifier is told to skip the SDK's `azp` check (it is
        // never passed an empty array — Clerk reads that as "reject everything"). See the module doc.
        const claims = await verifyClerkToken(token, { jwtKey, authorizedParties: [] });

        return { sub: claims.sub, userId: claims.userId };
    });
}
