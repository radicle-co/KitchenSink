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
 * @module contracts/authorizer
 * @description Types for the API Gateway Lambda REQUEST authorizer.
 * The authorizer validates IdP JWTs and injects user context into the
 * API Gateway request context for downstream Lambda functions.
 *
 * Source spec: specs/002-user-auth/spec.md FR-038, FR-039, FR-040, FR-042
 * Research: specs/002-user-auth/research.md §1
 */

import type { UserStatus } from './user.js';

/**
 * Custom claims namespace used in IdP access tokens.
 * All Commise custom claims are namespaced to comply with OIDC spec.
 */
export const CLAIM_NAMESPACE = 'https://commise.io/' as const;

/**
 * The decoded payload of an IdP access token with Commise custom claims.
 * Validated by the Lambda REQUEST authorizer on every API request.
 */
export interface IdpTokenPayload {
    /** IdP issuer. Must match the configured IdP issuer URL. */
    readonly iss: string;
    /** IdP subject (IdP user ID, e.g., `user_abc123`). */
    readonly sub: string;
    /** Token audience. Must include `https://api.commise.io`. */
    readonly aud: string | string[];
    /** Token expiration (Unix timestamp). */
    readonly exp: number;
    /** Token issued-at (Unix timestamp). */
    readonly iat: number;
    /** Canonical Commise user ID (UUIDv4). */
    readonly 'https://commise.io/userId': string;
    /**
     * IdP user ID — same as `sub`. Included for explicitness.
     * This is the spec's canonical claim path for the identity provider user identifier.
     */
    readonly 'https://commise.io/identityId': string;
    /** User's email address. */
    readonly 'https://commise.io/email': string;
    /** User's account status. Suspended users receive 403. */
    readonly 'https://commise.io/status': UserStatus;
}

/**
 * Context injected by the Lambda REQUEST authorizer into the API Gateway
 * request context. Downstream Lambda functions access this via
 * `event.requestContext.authorizer.<key>`.
 *
 * IMPORTANT: All values must be `string | number | boolean` — API Gateway
 * silently drops nested objects. JSON-serialize complex values if needed.
 *
 * @see research.md §1 — Context Injection
 */
export interface AuthorizerContext {
    /** Canonical Commise user ID (UUIDv4). Primary identifier for all downstream operations. */
    userId: string;
    /** IdP `sub` claim. For IdP Backend API calls only. */
    identityUserId: string;
    /** User's email address. */
    email: string;
    /** User's account status as a string. Check for `'active'` before proceeding. */
    status: string;
    /**
     * Whether this request is an impersonation session.
     * Stored as a string `'true'` or `'false'` due to API Gateway context scalar constraint.
     */
    isImpersonating: string;
}

/**
 * The IAM policy document returned by the Lambda REQUEST authorizer.
 * API Gateway caches this policy (keyed on the Authorization header) for
 * `resultsCacheTtl` seconds (default: 300s).
 */
export interface AuthorizerResponse {
    /** The principal identifier (use IdP `sub` for traceability). */
    principalId: string;
    /** IAM policy document. Effect: Allow or Deny. */
    policyDocument: {
        Version: '2012-10-17';
        Statement: Array<{
            Action: 'execute-api:Invoke';
            Effect: 'Allow' | 'Deny';
            Resource: string;
        }>;
    };
    /** Key-value context passed to downstream Lambda functions. All values are scalars. */
    context: AuthorizerContext;
}
