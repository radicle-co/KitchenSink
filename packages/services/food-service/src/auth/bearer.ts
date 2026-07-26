/**
 * The ONE authoritative `Authorization: Bearer <token>` parser for the food service's auth layer.
 *
 * Shared by the Clerk user-token {@link import('./food-auth.guard.js').FoodAuthGuard} and the
 * service-principal {@link import('./food-service-erasure.guard.js').FoodServiceErasureGuard} so both
 * verification surfaces extract the credential identically — a security-relevant parse kept in one place.
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
