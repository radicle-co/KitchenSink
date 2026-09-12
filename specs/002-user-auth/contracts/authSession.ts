/**
 * @module contracts/authSession
 * @description Client-side authentication session state. Not a database entity —
 * lives in Keychain/Keystore (mobile) or httpOnly cookies (web).
 *
 * Source spec: specs/002-user-auth/spec.md — Key Entities (AuthSession)
 */

/**
 * Client-side representation of an active authentication session.
 * The `userId` is extracted from the access token's custom claim
 * `https://commise.io/userId` and is the canonical Commise UUID.
 *
 * @see specs/002-user-auth/spec.md FR-006, FR-007, FR-008, FR-009
 */
export interface AuthSession {
    /**
     * IdP JWT access token. Included as `Authorization: Bearer <token>` on all API requests.
     * Expires at `expiresAt`.
     */
    readonly accessToken: string;
    /**
     * Opaque IdP refresh token. Used to silently refresh the access token when it expires.
     * Revoked in IdP on logout.
     */
    readonly refreshToken: string;
    /**
     * ISO 8601 timestamp when the access token expires.
     * When `Date.now() > Date.parse(expiresAt)`, the access token must be refreshed before use.
     */
    readonly expiresAt: string;
    /**
     * Canonical Commise user ID (UUIDv4).
     * Extracted from the access token's `https://commise.io/userId` custom claim.
     * Do NOT use `identityUserId` as an application identifier.
     */
    readonly userId: string;
    /**
     * IdP `sub` claim (e.g., `user_abc123`).
     * Used only for client-side IdP API calls. Not a Commise application identifier.
     */
    readonly identityUserId: string;
}

/**
 * Result of a token refresh operation.
 * Returns a new AuthSession with updated `accessToken` and `expiresAt`;
 * the `refreshToken` may be rotated (IdP refresh token rotation enabled).
 */
export interface TokenRefreshResult {
    /** The new AuthSession after a successful refresh. */
    session: AuthSession;
}
