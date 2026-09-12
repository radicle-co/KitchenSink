/**
 * The canonical authenticated Principal for the recipe service, and the Express request augmented
 * with it. Identity comes ONLY from the verified Clerk session token (REQ-IF-007, FR-038) — no
 * client-supplied header is ever trusted (the service is fronted by a public ALB, so any such header
 * would be forgeable, mirroring the identity service's PR #39 decision).
 */
import type { Request } from 'express';

import type { ContainmentSubject } from '../common/containmentPolicy.js';

/**
 * The verified principal behind a request.
 *
 * `userId` is THE owner key: ownership everywhere compares `owner_id == principal.userId`
 * (app-user ULID == app-user ULID). It is read networklessly from the verified session token's
 * `external_id` claim (which identity/002 syncs from `users.id`), surfaced by
 * `@kitchensink/clerk-verify` as `userId`. The Clerk `sub` is retained for trace/audit ONLY and is
 * **never** an owner key.
 */
export interface Principal extends ContainmentSubject {
    /** App-user ULID (identity's `users.id`) from the token's `external_id` claim — THE owner key. */
    readonly userId: string;
    /** Clerk subject (`identity_id`) — retained for trace/audit only, NEVER an owner key. */
    readonly sub: string;
    /** Authorized party the token was minted for (origin / service-client id), when present. */
    readonly azp?: string;
    /** Customized session-token email claim, when present. */
    readonly email?: string;
    /** Customized first-name claim, when present. */
    readonly firstName?: string;
    /** Customized last-name claim, when present. */
    readonly lastName?: string;
    /** Customized avatar/picture claim, when present. */
    readonly picture?: string;
    /** Authorization scopes from the token's signed `public_metadata` (empty = no privilege). */
    readonly scopes: string[];
    /** Authorization permissions from the token's signed `public_metadata` (empty = no privilege). */
    readonly permissions: string[];
    /*
     * ⛔ `principalKind` and `containment` arrive through `ContainmentSubject` (ADR-0040), REQUIRED rather than
     * optional: `principalKind` is `test` exactly when the verified token carries `public_metadata.testPrincipal ===
     * true`, and `containment` is this stage's `TEST_PRINCIPAL_CONTAINMENT`. Every policy that could let test data
     * reach real data takes both, so a Principal that omitted them would silently default a test principal to real.
     */
}

/**
 * The slice of a verified principal a service needs to ACT for it under containment (ADR-0040): the owner key plus
 * the two facts `evaluateContainment` decides on. A `Pick`, never a second declaration, so it cannot drift from what
 * the middleware verified.
 */
export type ActingPrincipal = Pick<Principal, 'userId' | 'principalKind' | 'containment'>;

/**
 * Narrow a verified principal to the slice a service may act on under containment. Pure.
 *
 * @param principal - The verified principal.
 * @returns Its owner key, principal kind, and the stage's containment mode — nothing else.
 */
export function actingPrincipalOf(principal: Principal): ActingPrincipal {
    return { userId: principal.userId, principalKind: principal.principalKind, containment: principal.containment };
}

/** An Express request augmented by `AuthMiddleware` with the verified principal. */
export interface AuthenticatedRequest extends Request {
    /** Present only after the middleware has verified the token (or applied the dev bypass). */
    principal?: Principal;
}
