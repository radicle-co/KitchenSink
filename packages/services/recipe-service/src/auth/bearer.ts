/**
 * The ONE authoritative `Authorization: Bearer <token>` parser for the recipe service's auth layer.
 *
 * Shared by the user-token {@link import('./auth.middleware.js').AuthMiddleware} and the service-principal
 * {@link import('./service-erasure.guard.js').ServiceErasureGuard} so the two verification surfaces extract
 * the credential identically — a security-relevant parse worth having in exactly one place.
 */

/**
 * Extract the bearer token from an `Authorization` header value, or `undefined` when absent/malformed.
 *
 * The credential group is `\S.*`, not `.+`: `.` matches a space, so `.+` and the preceding `\s+` overlap,
 * and for a header the pattern REJECTS the engine retries every split of the whitespace run between them —
 * quadratic in the header's length (CodeQL `js/polynomial-redos`; measured 270ms at 40KB on the old
 * pattern). Requiring the credential to start with a non-space leaves exactly one candidate split, so the
 * parse is linear. It also makes `'Bearer    '` yield `undefined` rather than `''`, which is the honest
 * answer for "no credential" and what `CallerToken.fromAuthorizationHeader` already treats it as.
 *
 * @param authorization - The raw `Authorization` header value, if any.
 * @returns The trimmed token, or `undefined`. Pure.
 */
export function extractBearer(authorization: string | undefined): string | undefined {
    if (typeof authorization !== 'string') {
        return undefined;
    }

    const match = authorization.match(/^Bearer\s+(\S.*)$/i);

    return match ? match[1]!.trim() : undefined;
}
