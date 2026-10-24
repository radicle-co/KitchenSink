/**
 * The verified SERVICE principal behind an internal service-to-service request (CR-002 / U4a), and the
 * Express request augmented with it.
 *
 * Deliberately a SEPARATE type from the user `Principal`: a service principal has NO owner *session*
 * — it carries a single BOUND target ({@link ServicePrincipal.ownerId}) proven by a signed, single-event
 * token, not an authenticated user's own identity. Keeping the two apart at the type level is what stops a
 * service principal from ever being read where an owner-session principal is expected, and vice versa.
 */
import type { Request } from 'express';
import type { ServiceErasureTokenClaims } from '@kitchensink/recipe-core';

/**
 * A verified service principal for the account-erasure capability. Structurally the decoded, verified
 * token claims: the bound target owner, the correlation/event id, and the machine actor label. Every field
 * comes from the cryptographically-verified token — never from the request body/query/headers.
 */
export type ServicePrincipal = ServiceErasureTokenClaims;

/**
 * An Express request augmented by `ServiceErasureGuard` with the
 * verified service principal. `servicePrincipal` is present ONLY after the guard has verified the token.
 */
export interface ServiceAuthenticatedRequest extends Request {
    /** Present only after `ServiceErasureGuard` verified the token. */
    servicePrincipal?: ServicePrincipal;
}
