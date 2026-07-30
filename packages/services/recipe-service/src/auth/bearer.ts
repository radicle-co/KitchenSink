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
 * @param authorization - The raw `Authorization` header value, if any.
 * @returns The trimmed token, or `undefined`. Pure.
 */
export function extractBearer(authorization: string | undefined): string | undefined {
    if (typeof authorization !== 'string') {
        return undefined;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    return match ? match[1]!.trim() : undefined;
}
