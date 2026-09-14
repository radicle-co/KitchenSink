/**
 * @module contracts/postReg
 * @description Types for the IdP user.created webhook handler.
 * The webhook Lambda runs asynchronously after the IdP fires a `user.created` event via Svix.
 * It creates User + Account + Profile records in the Commise database.
 * The canonical user ID (ULID) is surfaced in tokens via an IdP JWT template custom claim
 * (`https://commise.io/userId`) — no app_metadata writeback is required.
 *
 * Source spec: specs/002-user-auth/spec.md FR-013, FR-014, FR-015, FR-016
 * Research: specs/002-user-auth/research.md §3 (reconciliation as safety net)
 */

/**
 * The payload the user.created webhook Action sends to the Commise backend API
 * to create a User + Account record.
 */
export interface PostRegistrationPayload {
    /** IdP `sub` claim (e.g., `user_abc123`). */
    readonly identityUserId: string;
    /** User's email address as provided to the IdP during signup. */
    readonly email: string;
    /**
     * Display name derived from signup.
     * For email/password signups: derived from the email local part.
     * For social signups: from the provider's `name` claim if available.
     */
    readonly displayName: string;
    /** ISO 8601 timestamp — IdP user creation time. */
    readonly identityCreatedAt: string;
}

/**
 * The response returned by the Commise backend to the user.created webhook Action.
 * Contains the generated canonical user ID that the Action stores in app_metadata.
 */
export interface PostRegistrationResponse {
    /**
     * The generated canonical Commise user ID (ULID).
     * Surfaced in tokens via the `https://commise.io/userId` custom claim in the IdP JWT template.
     */
    readonly userId: string;
    /** Confirmation that the Account record was also created. */
    readonly accountCreated: boolean;
    /** Confirmation that the Profile record was also created. */
    readonly profileCreated: boolean;
}
