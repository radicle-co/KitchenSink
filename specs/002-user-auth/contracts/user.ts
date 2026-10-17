/**
 * ⛔ SUPERSEDED — HAND-WRITTEN, VERIFIED BY NOTHING. NOT THE CONTRACT AUTHORITY.
 *
 * Per GR-015 / `docs/CODING_STANDARDS.md` §15 / ADR-0014 the identity service AUTHORS its wire contract as
 * zod in the `*.schema.ts` files under `packages/services/identity/src/`, copied to `packages/schemas/identity`
 * (`@kitchensink/schema-identity`), from which the normative `openapi.yaml` is DERIVED. Where this file and
 * the service's zod disagree, THE SERVICE'S ZOD WINS.
 *
 * ⛔ Do not extend this file, and do not import it into `packages/`. Author the zod in the service.
 *
 * Retained as the historical record while documents under `specs/` still cite it.
 */
/**
 * @module contracts/user
 * @description TypeScript interfaces for the User and Account entities stored in RDS PostgreSQL.
 * These are the application-layer representations — database timestamps are returned as ISO 8601 strings.
 *
 * Source spec: specs/002-user-auth/spec.md — Key Entities
 * Data model: specs/002-user-auth/data-model.md
 */

/** Enumeration of valid user account statuses. */
export type UserStatus = 'active' | 'suspended';

/** Enumeration of valid subscription tier values. */
export type SubscriptionTier = 'free' | 'premium';

/**
 * Represents a registered Commise user stored in the database.
 * The `id` field is the canonical identifier across all Commise systems — it is a ULID
 * generated at signup and surfaced in tokens via the `https://commise.io/userId` custom claim.
 *
 * @see specs/002-user-auth/spec.md FR-013, FR-015, FR-018
 */
export interface User {
    /** Canonical Commise user ID (ULID). Primary key. Never changes after creation. */
    readonly id: string;
    /**
     * IdP `sub` claim (e.g., `user_abc123`).
     * Used ONLY for IdP Backend API calls — never as an application identifier.
     */
    readonly identityUserId: string;
    /**
     * User's email address. Synced from the IdP at registration. Read-only in Commise;
     * email changes require the IdP email change flow.
     */
    readonly email: string;
    /** User-editable display name. Non-empty, max 100 characters. */
    displayName: string;
    /** URL to the user's avatar image. Null if no avatar is set. */
    avatarUrl: string | null;
    /**
     * Account status. `'suspended'` users are blocked in the IdP and denied API access.
     * @see specs/002-user-auth/spec.md FR-041, FR-042
     */
    status: UserStatus;
    /** ISO 8601 timestamp when the user was created. */
    readonly createdAt: string;
    /** ISO 8601 timestamp when the user was last updated. */
    updatedAt: string;
}

/**
 * The subset of User fields that can be updated via the account edit flow.
 * Email is excluded — it is read-only in Commise.
 *
 * @see specs/002-user-auth/spec.md FR-019, FR-020, FR-021
 */
export interface UserUpdateInput {
    /** New display name. Must be non-empty, max 100 characters. */
    displayName?: string;
    /** New avatar URL after upload. Null to remove the avatar. */
    avatarUrl?: string | null;
}

/**
 * Represents the account/profile details associated with a User.
 * Created alongside the User during signup. Deleted alongside the User on account deletion.
 *
 * @see specs/002-user-auth/spec.md FR-014, Key Entities
 */
export interface Account {
    /** Account identifier (UUIDv4). Primary key. */
    readonly id: string;
    /** Foreign key to the associated User. One-to-one relationship. */
    readonly userId: string;
    /**
     * Subscription tier. Managed by the subscription feature.
     * @see specs/001-commise-recipe-app/spec.md FR-040, FR-041
     */
    subscriptionTier: SubscriptionTier;
    /** ISO 8601 timestamp when the account was created. */
    readonly createdAt: string;
    /** ISO 8601 timestamp when the account was last updated. */
    updatedAt: string;
}

/**
 * Combined view of User + Account used by the profile and account edit pages.
 * Returned by the `GET /users/me` endpoint.
 */
export interface UserProfile {
    /** The User entity. */
    user: User;
    /** The associated Account entity. */
    account: Account;
}
