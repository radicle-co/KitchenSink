/**
 * The viewer-request DECISION for the CloudFront edge: what reaches the origin, what is answered `401` at
 * the edge, and which cache partition a verified caller reads and writes (ADR-0020 / plan U16).
 *
 * DESIGN PATTERN: **Humble Object**. Everything decidable lives here as pure functions plus one factory over
 * an INJECTED verifier, so the whole contract is testable without a key, a token, or CloudFront. The Lambda
 * adapter (`src/edge-verifier/handler.ts`) is ten mechanical lines that supply
 * `@kitchensink/clerk-verify`'s networkless `verifyClerkToken` and the build-time-inlined public key —
 * nothing to test and nothing to get wrong. Keeping the Clerk dependency OUT of `lib/` is also structural:
 * `lib/` is the CDK app's EMIT project, run as compiled JS under plain `node` at deploy time, and
 * `@kitchensink/clerk-verify` exports `./src` (ADR-0013's `ERR_MODULE_NOT_FOUND` trap).
 *
 * ## The edge is a CACHE PARTITIONER, not the authorization boundary
 *
 * Verifying a token proves the caller is _someone_; it does not prove they may read _this resource_. Recipe's
 * read routes are owner-scoped from the token — every user requests the identical URL and must receive
 * different content — so a URL-only cache key would serve the first caller's recipe list to every other
 * authenticated caller. That was the P0 in ADR-0020's first design. The cure is this module's
 * {@link principalCacheKey}, injected as {@link EDGE_PRINCIPAL_HEADER} and named in the cache key of
 * recipe's owner-scoped behaviors (`EdgeStack`).
 *
 * Authorization itself stays at the ORIGIN, which re-verifies the same bearer and applies ownership. So a
 * verifier that let a request through wrongly costs a cache partition, never a disclosure; a verifier that
 * failed OPEN — leaving the partition header unset — would collapse every caller onto one cache entry, which
 * is why `EdgeStack` refuses to synthesize without a real bundle rather than shipping a placeholder.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { CloudFrontRequest, CloudFrontRequestEvent, CloudFrontRequestResult } from 'aws-lambda';

import { EDGE_PRINCIPAL_HEADER, isPassthroughRequest } from './edgeRoutes.js';

/** The claims the edge reads from a verified Clerk token. A structural subset of `VerifiedClerkClaims`. */
export interface EdgePrincipal {
    /** The Clerk subject — always present on a verified token. */
    readonly sub: string;
    /**
     * The app-user ULID (`external_id`), when Clerk has been backfilled with it. Absent during the
     * first-token sync race, which the ORIGIN answers with `IDENTITY_SYNC_PENDING` — the edge does not
     * require it, so that contract still reaches the client intact.
     */
    readonly userId?: string | undefined;
}

/** Verifies a raw bearer token, resolving its claims or THROWING. Supplied by the Lambda adapter. */
export type EdgeTokenVerifier = (token: string) => Promise<EdgePrincipal>;

/** The `code` every service's error envelope uses for a `401` (`@kitchensink/nest-error-envelope`). */
const UNAUTHORIZED_CODE = 'UNAUTHORIZED';

/**
 * The generic `401` message. Deliberately says nothing about WHY: expiry, signature, issuer and malformation
 * are one opaque outcome, exactly as `ClerkVerificationError` is at every origin.
 */
const UNAUTHORIZED_MESSAGE = 'Missing or invalid authorization token';

/** `Bearer <token>`, RFC 6750 §2.1: one space-delimited scheme, case-insensitive, non-empty credential. */
const BEARER_PATTERN = /^Bearer\s+(\S+)$/iu;

/**
 * The opaque cache partition for a verified principal.
 *
 * A digest rather than the id itself, for three reasons that all matter:
 *
 *  1. **Injectivity is the security property.** Two principals sharing a partition IS the P0 data leak, so
 *     the transform must not be able to map two ids onto one value. SHA-256 gives that; any "sanitize unsafe
 *     characters" scheme does not.
 *  2. **The value must be header-safe.** CloudFront rejects a request whose header value is not printable
 *     ASCII, turning an exotic id into a `503` rather than a `401`.
 *  3. **It must not read as an identity.** The header is forwarded to the origin (a cache-key header always
 *     is). An opaque digest cannot be mistaken for — or quietly promoted to — a user id by a future reader.
 *
 * The two id spaces are domain-separated so a Clerk `sub` and an app ULID with the same text cannot collide.
 * A principal whose ULID has not yet been minted therefore partitions on its `sub` and moves to a new
 * partition once identity backfills `external_id`; that costs one duplicated cache entry and never a leak.
 *
 * @param principal - The verified claims.
 * @returns A base64url SHA-256 digest, safe as a header value. Pure.
 */
export function principalCacheKey(principal: EdgePrincipal): string {
    const scoped = principal.userId === undefined ? `sub:${principal.sub}` : `uid:${principal.userId}`;

    return createHash('sha256').update(scoped).digest('base64url');
}

/** The single-valued header entry CloudFront wants, with a canonically-cased `key`. Pure. */
function headerEntry(name: string, value: string): CloudFrontRequest['headers'][string] {
    return [{ key: name, value }];
}

/** The edge-generated `401`, in the repo-wide `{ code, message }` envelope and explicitly uncacheable. */
function unauthorized(): CloudFrontRequestResult {
    return {
        status: '401',
        statusDescription: 'Unauthorized',
        headers: {
            // CloudFront does not cache a response generated by a VIEWER-request function, and `no-store`
            // says so a second time — at the one place a stale `401` would be served to a caller whose token
            // is now perfectly valid. Two mechanisms, because the cost of the miss is a user locked out.
            'cache-control': headerEntry('Cache-Control', 'no-store'),
            'content-type': headerEntry('Content-Type', 'application/json'),
        },
        body: JSON.stringify({ code: UNAUTHORIZED_CODE, message: UNAUTHORIZED_MESSAGE }),
    };
}

/**
 * Extract the bearer credential from an `Authorization` header value.
 *
 * @param value - The raw header value, or `undefined`.
 * @returns The token, or `undefined` when the header is absent or not a well-formed bearer. Pure.
 */
function extractBearer(value: string | undefined): string | undefined {
    return value === undefined ? undefined : (BEARER_PATTERN.exec(value)?.[1] ?? undefined);
}

/**
 * Build the Lambda@Edge viewer-request handler over an injected token verifier.
 *
 * The order of operations is the contract, and each step is load-bearing:
 *
 *  1. **Strip any client-supplied {@link EDGE_PRINCIPAL_HEADER}** — FIRST, before any branch. The header is
 *     the cache key on owner-scoped behaviors, so a viewer able to set it chooses which cache entry it reads
 *     and writes. That is the same P0 as a URL-only key, reached from the other side.
 *  2. **Passthrough** (`OPTIONS`, `/health*`, `/api/v1/internal/*`) — BEFORE verification, never after.
 *  3. **Verify**, and answer `401` on a missing/malformed header or any verifier failure.
 *  4. **Mint the partition header** from the verified claims.
 *
 * @param verify - The networkless token verifier (the Clerk one, in production).
 * @returns The viewer-request handler.
 * @sideEffect Mutates the event's request headers in place — which is how a Lambda@Edge viewer-request
 *   function returns a modified request; the mutated object IS the return value.
 */
export function createEdgeVerifier(
    verify: EdgeTokenVerifier,
): (event: CloudFrontRequestEvent) => Promise<CloudFrontRequestResult> {
    return async (event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> => {
        const request = event.Records[0]!.cf.request;

        delete request.headers[EDGE_PRINCIPAL_HEADER];

        if (isPassthroughRequest({ method: request.method, uri: request.uri })) {
            return request;
        }

        const token = extractBearer(request.headers['authorization']?.[0]?.value);

        if (token === undefined) {
            return unauthorized();
        }

        let principal: EdgePrincipal;

        try {
            principal = await verify(token);
        } catch {
            // Every failure mode is one outcome: the reason never reaches the caller, and never a log line
            // at the edge either — a viewer-request function's logs land in whichever region served the
            // request, so they are the worst possible place to put a token diagnostic.
            return unauthorized();
        }

        request.headers[EDGE_PRINCIPAL_HEADER] = headerEntry(EDGE_PRINCIPAL_HEADER, principalCacheKey(principal));

        return request;
    };
}
