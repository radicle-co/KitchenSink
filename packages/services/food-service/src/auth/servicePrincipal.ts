/**
 * The verified SERVICE principal behind an internal food-erasure request (CR-002 / U4b / R11), and the
 * Express request augmented with it.
 *
 * Deliberately a SEPARATE type from the Clerk user principal on `AuthenticatedRequest`
 * (`./authenticatedPrincipal.ts`): a service principal has NO user session — it carries a single BOUND
 * target ({@link ServicePrincipal.ownerId}) proven by a signed, single-event token, not an authenticated
 * user's identity. Keeping the two apart at the type level is what stops a
 * service principal from ever being read where a user principal is expected, and vice versa.
 */
import type { Request } from 'express';
import type { ServiceErasureTokenClaims } from '@kitchensink/recipe-core';

/**
 * A verified service principal for the food account-erasure capability. Structurally the decoded, verified
 * token claims: the bound target owner ULID, the correlation/event id, and the machine actor label. Every
 * field comes from the cryptographically-verified token — never from the request body/query/headers.
 */
export type ServicePrincipal = ServiceErasureTokenClaims;

/**
 * An Express request augmented by `FoodServiceErasureGuard`
 * with the verified service principal. Present ONLY after the guard has verified the token.
 */
export interface ServiceAuthenticatedRequest extends Request {
    /** Present only after `FoodServiceErasureGuard` verified it. */
    servicePrincipal?: ServicePrincipal;
}
