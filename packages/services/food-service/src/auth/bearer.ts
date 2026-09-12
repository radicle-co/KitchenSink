/**
 * The ONE authoritative `Authorization: Bearer <token>` parser for the food service's auth layer.
 *
 * Shared by the Clerk user-token `FoodAuthGuard` (`./foodAuth.guard.ts`) and the
 * service-principal `FoodServiceErasureGuard` (`./foodServiceErasure.guard.ts`) so both
 * verification surfaces extract the credential identically — a security-relevant parse kept in one place.
 */

/**
 * Extract the bearer token from an `Authorization` header value, or `undefined` when absent/malformed.
 *
 * ## Why the credential group is `\S.*` and not `.+`
 *
 * `.` matches a space, so `.+` and the preceding `\s+` OVERLAP: for a header the pattern ultimately
 * REJECTS, the engine has to retry every way of splitting the whitespace run between the two, which is
 * quadratic in the header's length (CodeQL `js/polynomial-redos`). Measured on the old pattern: 2.8ms at
 * 4KB of whitespace, 43ms at 16KB, 270ms at 40KB — and all of it blocks the event loop BEFORE the FR-052
 * `AuthLoadShedder` gets a chance to shed anything, since parsing
 * the header is what produces the token the shedder is keyed on. Requiring the credential to START with a
 * non-space removes the overlap: exactly one split can satisfy the pattern, so the parse is linear.
 *
 * Reaching the quadratic path needs a character `\s` accepts but `.` rejects (a line terminator) to force
 * the failure, which a conforming HTTP/1.1 header value cannot carry — so the practical exposure through
 * the ALB is low. It is fixed regardless: this is an exported pure function on the credential path of
 * every request, the guarantee should not rest on an upstream parser's strictness, and the correct pattern
 * is no more complex than the vulnerable one.
 *
 * It also makes a whitespace-only credential (`'Bearer    '`) `undefined` instead of the empty string the
 * old pattern returned — the honest answer for "no credential", and previously masked only by every caller
 * happening to treat `''` as absent.
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
