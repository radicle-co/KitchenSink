/**
 * THE authority for what the CloudFront edge lets through WITHOUT a Clerk token, and for the header the
 * viewer-request function mints as a cache-key component (ADR-0020 / plan U16).
 *
 * ## Why this is one module and not two lists
 *
 * The same knowledge is needed in two places that cannot see each other: the Lambda@Edge handler
 * (`src/edge-verifier/handler.ts`, bundled by esbuild and executed at the edge) decides per REQUEST, and
 * `lib/platform/EdgeStack.ts` turns the same patterns into CloudFront cache BEHAVIORS with no function
 * attached at all. Two copies would diverge the way `listenerPriority.ts`'s per-service copies already did
 * one namespace over — and a divergence here is not a deploy error, it is either an unauthenticated hole or
 * a silently broken GDPR fan-out.
 *
 * ## The three exemptions, and what each one costs to get wrong (ADR-0020 traps 2 and 3)
 *
 *  1. **any `OPTIONS`** — CORS preflights carry no credentials BY SPECIFICATION. Rejecting them blocks every
 *     browser call while the service is perfectly healthy to `curl`. This repository has already encoded that
 *     exact failure once, in `deployedSmoke.ts`'s `classifyPreflight`. `OPTIONS` is a METHOD, not a path, so
 *     it cannot be expressed as a CloudFront path pattern — it lives in the handler and nowhere else.
 *  2. **`/health*`** — `prod-deploy.yml` curls `/health` unauthenticated and expects `200`; so does the ALB
 *     target-group health check.
 *  3. **`/api/v1/internal/*`** (and its live `/v1` alias, ADR-0011) — the erasure fan-out POSTs here carrying
 *     a short-lived **EdDSA service token minted by identity**, not a Clerk token. A Clerk verifier rejects
 *     it, the deletion worker rethrows, SQS retries forever, and the GDPR path plan U1/U2 exist to repair
 *     breaks again, silently. The prefix is a service-principal surface and the ORIGIN verifies it (each
 *     service's `ServiceErasureGuard`), which is why dropping the edge out of that path costs no
 *     authentication.
 *
 * ⚠️ Both `/api/v1/internal/*` AND `/v1/internal/*` are listed. The `/v1` form is a DEPRECATED ALIAS that is
 * live in production (ADR-0011) and is dialed service-to-service; exempting only the canonical form would
 * leave a working production path answering `401` from the edge.
 *
 * ## Matching semantics are CloudFront's, deliberately
 *
 * {@link matchesPathPattern} implements the subset of CloudFront path-pattern matching these entries use — a
 * literal, or a literal followed by `*`. The handler matches the SAME way the distribution does, so a URI
 * that a behavior exempts and the handler would have challenged (or the reverse) cannot exist.
 *
 * @module
 */

/**
 * The request header the viewer-request function mints to partition the cache per principal.
 *
 * ⛔ The `x-commise-` prefix is load-bearing, not branding. This was `x-edge-principal`, and creating the
 * cache policy failed outright in production: `The parameter Headers contains x-edge-principal that is not
 * allowed`. **`X-Edge-*` is CloudFront's own reserved namespace**, so a cache policy refuses to key on one.
 * Nothing local catches that — the name is a plain string and the synth is valid CloudFormation — so
 * `edgeVerifier.test.ts` now asserts the prefix instead. Do not move it back, and do not reach for
 * `x-amz-cf-*`, `x-amzn-*` or `cloudfront-*` either; all are reserved.
 *
 * ⛔ It is a CACHE PARTITION TOKEN, never an identity assertion. It reaches the origin only because a
 * cache-key header is forwarded by definition, and every origin authenticates the `Authorization` bearer
 * itself (`AuthMiddleware`). Nothing downstream may trust it — and nothing does: the value is an opaque
 * digest (`principalCacheKey`, in `./edgeVerifier.ts`), so it is not usable as a user id even by mistake.
 */
export const EDGE_PRINCIPAL_HEADER = 'x-commise-principal';

/**
 * The path patterns served WITHOUT edge verification, in CloudFront path-pattern form.
 *
 * Consumed twice: the handler passes a matching request straight through, and `EdgeStack` gives each pattern
 * its own cache behavior with **no function association**, so the edge is not in these paths at all — a
 * cold start or a bug in the verifier cannot take down `/health` or the erasure fan-out. The handler's copy
 * of the decision is the belt to that braces.
 */
export const PASSTHROUGH_PATH_PATTERNS = ['/health*', '/api/v1/internal/*', '/v1/internal/*'] as const;

/** The one HTTP method exempt regardless of path — a CORS preflight, which carries no credentials by spec. */
export const PASSTHROUGH_METHOD = 'OPTIONS';

/**
 * Whether `uri` matches a CloudFront path pattern, for the subset of the syntax used here.
 *
 * A trailing `*` is a prefix match on everything before it; anything else is an exact match. CloudFront's
 * full syntax also allows a `*` in the middle, which nothing here uses and which is deliberately NOT
 * supported rather than approximated. Pure.
 *
 * @param pattern - The CloudFront path pattern, e.g. `/health*`.
 * @param uri - The request URI (path only — CloudFront's `request.uri` never carries the query string).
 * @returns `true` when CloudFront's behavior for `pattern` would serve `uri`.
 */
export function matchesPathPattern(pattern: string, uri: string): boolean {
    return pattern.endsWith('*') ? uri.startsWith(pattern.slice(0, -1)) : uri === pattern;
}

/**
 * Whether this request is served WITHOUT edge verification.
 *
 * @param request - The request's method and URI.
 * @returns `true` for any `OPTIONS`, or for a URI matching {@link PASSTHROUGH_PATH_PATTERNS}. Pure.
 */
export function isPassthroughRequest(request: { readonly method: string; readonly uri: string }): boolean {
    return (
        request.method.toUpperCase() === PASSTHROUGH_METHOD ||
        PASSTHROUGH_PATH_PATTERNS.some((pattern) => matchesPathPattern(pattern, request.uri))
    );
}
